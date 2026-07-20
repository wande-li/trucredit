// SES Inbound Email Webhook — Receives SNS notifications from AWS SES
// This route is called by AWS SNS, not by Shopify — no OAuth required.
// SNS signature is verified using AWS signing certificate.
import type { ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import { simpleParser } from "mailparser";
import { processInboundEmail } from "~/services/inbound.server";
import { logger } from "~/services/logger.server";

/**
 * Verify SNS message signature using AWS signing certificate.
 * Follows: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 */
async function verifySnsSignature(body: Record<string, string>): Promise<boolean> {
  const certUrl = body.SigningCertURL;
  const signature = body.Signature;
  const type = body.Type;

  // Only verify Notification type (SubscriptionConfirmation uses SubscribeURL auto-confirm)
  if (type !== "Notification") return true;

  if (!certUrl || !signature) {
    logger.app("WARN", "SNS message missing SigningCertURL or Signature");
    return false;
  }

  // Validate certificate URL — must be from Amazon SNS
  let certUrlObj: URL;
  try {
    certUrlObj = new URL(certUrl);
  } catch {
    logger.app("WARN", "SNS invalid SigningCertURL", undefined, { certUrl });
    return false;
  }

  if (
    !certUrlObj.hostname.endsWith(".amazonaws.com") &&
    !certUrlObj.hostname.endsWith(".amazonaws.com.cn")
  ) {
    logger.app("WARN", "SNS SigningCertURL not from AWS", undefined, { hostname: certUrlObj.hostname });
    return false;
  }
  if (certUrlObj.protocol !== "https:") {
    logger.app("WARN", "SNS SigningCertURL not HTTPS");
    return false;
  }

  // Download the certificate
  let certPem: string;
  try {
    const resp = await fetch(certUrl);
    certPem = await resp.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "SNS failed to download signing certificate", msg);
    return false;
  }

  // Build the string to verify (canonical string for the specific SNS message type)
  const signableKeys = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
  if (type === "Notification") {
    signableKeys.unshift("SubscribeURL" as never); // not actually used for Notification, but for ordering
  }
  // Build exactly per AWS spec
  const stringToSign = [
    "Message",
    "MessageId",
    ...(type === "Notification" ? [] : ["SubscribeURL"]),
    "Timestamp",
    "TopicArn",
    "Type",
  ]
    .filter((key) => body[key] !== undefined)
    .map((key) => `${key}\n${body[key]}\n`)
    .join("");

  try {
    const verifier = crypto.createVerify("sha1WithRSAEncryption");
    verifier.update(stringToSign, "utf8");
    return verifier.verify(certPem, signature, "base64");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "SNS signature verification error", msg);
    return false;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: string;
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Parse SNS outer envelope
  let snsEnvelope: Record<string, string> | null = null;
  try {
    snsEnvelope = JSON.parse(rawBody) as Record<string, string>;
  } catch {
    // Not JSON — treat as raw email (direct SES delivery)
    body = rawBody;
  }

  // Verify SNS signature before processing
  if (snsEnvelope) {
    const sigValid = await verifySnsSignature(snsEnvelope);
    if (!sigValid) {
      logger.app("WARN", "SNS signature verification failed — rejecting message");
      return new Response("Forbidden", { status: 403 });
    }

    // Subscription confirmation (initial setup)
    if (snsEnvelope.Type === "SubscriptionConfirmation" && snsEnvelope.SubscribeURL) {
      logger.app("INFO", "SNS subscription confirmation received", undefined, {
        topicArn: snsEnvelope.TopicArn,
      });
      try {
        await fetch(snsEnvelope.SubscribeURL);
        logger.app("INFO", "SNS subscription confirmed");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "SNS subscription confirmation failed", undefined, { error: msg });
      }
      return new Response("OK", { status: 200 });
    }

    // Extract SES message from SNS Notification
    if (snsEnvelope.Type === "Notification" && snsEnvelope.Message) {
      body = snsEnvelope.Message;
    } else {
      body = rawBody;
    }
  }

  // Step 3: Parse the email content
  try {
    // SES delivers as raw MIME or as JSON with content field
    const ses = JSON.parse(body) as {
      content?: string;
      mail?: {
        messageId?: string;
        source?: string;
        destination?: string[];
        timestamp?: string;
        commonHeaders?: {
          from?: string[];
          to?: string[];
          subject?: string;
        };
      };
      receipt?: { action?: { type?: string } };
    };

    let emailBody = "";
    let from = ses.mail?.commonHeaders?.from?.[0] ?? ses.mail?.source ?? "";
    const to = ses.mail?.commonHeaders?.to ?? ses.mail?.destination ?? [];
    const subject = ses.mail?.commonHeaders?.subject ?? "(no subject)";
    const messageId = ses.mail?.messageId ?? "";
    const date = ses.mail?.timestamp ?? "";

    // If content is base64 MIME, parse it
    if (ses.content) {
      try {
        const raw = Buffer.from(ses.content, "base64").toString("utf-8");
        const parsedMail = await simpleParser(raw);
        emailBody = parsedMail.text ?? (parsedMail.html && typeof parsedMail.html === "string" ? parsedMail.html.replace(/<[^>]*>/g, "") : "") ?? "";
        from = parsedMail.from?.value?.[0]?.address ?? from;
      } catch {
        emailBody = "(could not parse email content)";
      }
    }

    // Process the inbound email
    const result = await processInboundEmail({
      messageId,
      from,
      to,
      subject,
      body: emailBody || "(no body)",
      date,
    });

    logger.app("INFO", "Inbound email processed", undefined, {
      messageId,
      matched: result.matched,
      taskId: result.taskId,
    });

    return new Response("OK", { status: 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Failed to parse inbound email", undefined, { error: msg });
    return new Response("OK", { status: 200 }); // Always 200 to prevent SNS retries
  }
};
