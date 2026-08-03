import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

/**
 * SES → SNS → HTTP Webhook for bounce/complaint notifications.
 *
 * AWS SES sends bounce and complaint events to an SNS topic,
 * which POSTs a JSON notification to this endpoint.
 *
 * Request format:
 *   POST /api/ses-notifications
 *   Headers: x-amz-sns-message-type
 *   Body: SNS notification JSON
 *
 * Handles:
 *   - Hard bounces → mark customer emailBouncedAt
 *   - Complaints → log and optionally mark
 *   - SubscriptionConfirmations → auto-confirm
 */

interface SesBounce {
  bounceType: "Permanent" | "Transient" | "Undetermined";
  bouncedRecipients: Array<{ emailAddress: string; action?: string; status?: string }>;
  timestamp: string;
}

interface SesComplaint {
  complainedRecipients: Array<{ emailAddress: string }>;
  complaintFeedbackType: string;
  timestamp: string;
}

interface SesNotification {
  notificationType: "Bounce" | "Complaint" | "Delivery";
  mail: {
    messageId: string;
    destination: string[];
    timestamp: string;
  };
  bounce?: SesBounce;
  complaint?: SesComplaint;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const t0 = Date.now();

  try {
    const contentType = request.headers.get("content-type") ?? "";

    // SNS can send notifications in two formats: raw JSON or x-www-form-urlencoded
    let body: unknown;
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      const text = await request.text();
      try {
        body = JSON.parse(text);
      } catch {
        logger.app("WARN", "api.ses-notifications — unparseable body", text.slice(0, 200));
        return json({ ok: false, reason: "unparseable_body" }, { status: 400 });
      }
    }

    const msg = body as Record<string, unknown>;

    // Handle SNS subscription confirmation
    if (msg.Type === "SubscriptionConfirmation" && msg.SubscribeURL) {
      logger.app("INFO", "api.ses-notifications — SNS subscription confirmation received, auto-confirming");
      // Auto-confirm by visiting the URL (async, don't block response)
      fetch(String(msg.SubscribeURL)).catch((e: unknown) => {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "api.ses-notifications — SNS subscription confirm fetch failed", errMsg);
      });
      return json({ ok: true });
    }

    // Handle SNS notification
    if (msg.Type === "Notification" && msg.Message) {
      let message: string;
      if (typeof msg.Message === "string") {
        message = msg.Message;
      } else {
        message = JSON.stringify(msg.Message);
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(message);
      } catch {
        logger.app("WARN", "api.ses-notifications — unparseable Message JSON", message.slice(0, 200));
        return json({ ok: false, reason: "unparseable_message" }, { status: 400 });
      }

      const notification = parsed as unknown as SesNotification;

      if (!notification.notificationType || !notification.mail) {
        logger.app("WARN", "api.ses-notifications — missing notificationType or mail", null);
        return json({ ok: false, reason: "missing_fields" }, { status: 400 });
      }

      // Collect all affected email addresses
      const recipients = notification.mail.destination ?? [];

      if (notification.notificationType === "Bounce" && notification.bounce) {
        const isHardBounce = notification.bounce.bounceType === "Permanent";
        const bouncedEmails = notification.bounce.bouncedRecipients.map((r) => r.emailAddress);

        logger.app(isHardBounce ? "WARN" : "INFO", "api.ses-notifications — bounce received", null, {
          bounceType: notification.bounce.bounceType,
          emails: bouncedEmails,
          messageId: notification.mail.messageId,
        });

        // For hard bounces, mark matching customers
        if (isHardBounce && bouncedEmails.length > 0) {
          const now = new Date();
          for (const email of bouncedEmails) {
            try {
              const result = await prisma.customer.updateMany({
                where: {
                  email: email.toLowerCase().trim(),
                  emailBouncedAt: null, // only update if not already bounced
                },
                data: { emailBouncedAt: now },
              });
              if (result.count > 0) {
                logger.app("INFO", "api.ses-notifications — customer marked as bounced", null, { email });
              }
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              logger.app("WARN", "api.ses-notifications — failed to mark customer bounced", errMsg);
            }
          }
        }
      } else if (notification.notificationType === "Complaint" && notification.complaint) {
        const complaintEmails = notification.complaint.complainedRecipients.map((r) => r.emailAddress);

        logger.app("WARN", "api.ses-notifications — complaint received", null, {
          complaintType: notification.complaint.complaintFeedbackType,
          emails: complaintEmails,
          messageId: notification.mail.messageId,
        });

        // Mark complained customers — these may need manual review
        const now = new Date();
        for (const email of complaintEmails) {
          try {
            await prisma.customer.updateMany({
              where: { email: email.toLowerCase().trim() },
              data: { emailBouncedAt: now },
            });
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.app("WARN", "api.ses-notifications — failed to mark customer complained", errMsg);
          }
        }
      } else if (notification.notificationType === "Delivery") {
        // Successful delivery — no action needed
        logger.app("INFO", "api.ses-notifications — delivery confirmed", null, {
          messageId: notification.mail.messageId,
          recipients,
        });
      }
    }

    return json({ ok: true }, {
      status: 200,
      headers: { "X-Robots-Tag": "noindex" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "api.ses-notifications — unhandled error", msg, { durationMs: Date.now() - t0 });
    return json({ ok: false, reason: "internal_error" }, { status: 500 });
  }
};

// For SNS health checks / SubscribeURL GET requests
export const loader = async () => {
  return json({ ok: true }, { status: 200 });
};
