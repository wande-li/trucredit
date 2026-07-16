// SES Inbound Email Webhook — Receives SNS notifications from AWS SES
// This route is called by AWS SNS, not by Shopify — no OAuth required.
import type { ActionFunctionArgs } from "@remix-run/node";
import { simpleParser } from "mailparser";
import { processInboundEmail } from "~/services/inbound.server";
import { logger } from "~/services/logger.server";

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

  // AWS SNS sends JSON; SES notifications are nested in the Message field
  try {
    body = rawBody;
    const sns = JSON.parse(rawBody) as {
      Type?: string;
      Message?: string;
      SubscribeURL?: string;
      Token?: string;
      TopicArn?: string;
    };

    // Step 1: Subscription confirmation (initial setup)
    if (sns.Type === "SubscriptionConfirmation" && sns.SubscribeURL) {
      logger.app("INFO", "SNS subscription confirmation received", undefined, {
        topicArn: sns.TopicArn,
      });
      // Auto-confirm by visiting the SubscribeURL
      try {
        await fetch(sns.SubscribeURL);
        logger.app("INFO", "SNS subscription confirmed", undefined, {});
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "SNS subscription confirmation failed", undefined, { error: msg });
      }
      return new Response("OK", { status: 200 });
    }

    // Step 2: Notification — extract the SES message
    if (sns.Type === "Notification" && sns.Message) {
      body = sns.Message;
    }
  } catch {
    // Not JSON? Treat as raw email (direct SES delivery)
    body = rawBody;
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
