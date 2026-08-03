import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import prisma from "~/db.server";
import { generatePortalToken, buildPortalUrl } from "~/services/token.server";
import { sendSimpleEmail } from "~/services/email-delivery.server";
import { logger } from "~/services/logger.server";
import PortalErrorBoundary from "~/components/PortalErrorBoundary";

export const meta: MetaFunction = () => [{ title: "Renew Portal Access — TruCredit" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    throw new Response("Missing shop parameter. Use ?shop=your-store.myshopify.com", { status: 400 });
  }

  const shopData = await prisma.shop.findUnique({
    where: { shopDomain: shop },
    select: { shopDomain: true, emailFromName: true },
  });

  if (!shopData) {
    throw new Response("Store not found. Please check the URL and try again.", { status: 404 });
  }

  return json({
    shopDomain: shopData.shopDomain,
    shopName: shopData.emailFromName || shopData.shopDomain,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ta = Date.now();
  const formData = await request.formData();
  const email = formData.get("email")?.toString()?.trim().toLowerCase();
  const shopDomain = formData.get("shopDomain")?.toString();

  if (!email) return json({ error: "Email is required." }, { status: 400 });
  if (!shopDomain) return json({ error: "Store context missing. Please try the link again." }, { status: 400 });

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return json({ error: "Store not found." }, { status: 404 });

  const customer = await prisma.customer.findFirst({
    where: { shopId: shop.id, email, deletedAt: null },
    select: { id: true, name: true, email: true, status: true },
  });

  // Generic message — don't reveal whether the email exists (security)
  const genericSuccess = "If the email is registered, a new portal link has been sent. Please check your inbox.";
  if (!customer) {
    logger.app("INFO", "portal.renew — no customer found for email", undefined, { durationMs: Date.now() - ta });
    return json({ success: true, message: genericSuccess });
  }
  if (customer.status === "BLACKLISTED") {
    logger.app("WARN", "portal.renew — blacklisted customer attempted", undefined, { customerId: customer.id });
    return json({ success: true, message: genericSuccess });
  }

  const token = await generatePortalToken({ shopId: shop.id, customerId: customer.id });
  const portalUrl = buildPortalUrl(token);

  const emailResult = await sendSimpleEmail({
    shopId: shop.id,
    toEmail: customer.email,
    subject: "Your TruCredit Portal Access",
    htmlBody: `<p>Hi ${customer.name || "there"},</p>
<p>Here is your renewed portal access link:</p>
<p style="font-size:18px;margin:16px 0">
  <a href="${portalUrl}">Access Your Portal</a>
</p>
<p>Or copy this link into your browser:</p>
<p>${portalUrl}</p>
<p>You can view your credit balance, invoices, payment history, and account statements here.</p>
<p style="color:#64748b;font-size:13px">This link is valid for 7 days and renews on each visit.</p>`,
  });

  if (emailResult.sent) {
    logger.app("INFO", "portal.renew — new token sent", undefined, {
      durationMs: Date.now() - ta,
      customerId: customer.id,
    });
  } else {
    logger.app("WARN", "portal.renew — email delivery failed", emailResult.error);
  }

  return json({
    success: true,
    message: "A new portal access link has been sent to your email. Please check your inbox.",
  });
};

export default function PortalRenewPage() {
  const { shopDomain, shopName } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (actionData?.success) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <div style={styles.checkmark}>&#10003;</div>
          <h1 style={styles.title}>Email Sent</h1>
          <p style={styles.message}>{actionData.message}</p>
          <p style={styles.hint}>
            The link renews every time you visit. Bookmark the portal page for easy access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.logo}>TC</div>
        <h1 style={styles.title}>Renew Portal Access</h1>
        <p style={styles.store}>{shopName}</p>
        <p style={styles.hint}>
          Your portal link has expired (or you are using a new device). Enter your email to receive a new access link.
        </p>

        {actionData?.error && <p style={styles.error}>{actionData.error}</p>}

        <Form method="post">
          <input type="hidden" name="shopDomain" value={shopDomain} />
          <input
            type="email"
            name="email"
            placeholder="your@email.com"
            required
            style={styles.input}
            autoFocus
            autoComplete="email"
          />
          <button type="submit" style={styles.button}>
            Send New Link
          </button>
        </Form>

        <p style={styles.backLink}>
          <a href={`https://${shopDomain}`} style={{ color: "#64748b", textDecoration: "none" }}>
            &larr; Back to Store
          </a>
        </p>
      </div>
    </div>
  );
}

export { PortalErrorBoundary as ErrorBoundary };

const styles = {
  wrapper: {
    maxWidth: 440,
    margin: "80px auto",
    padding: "0 20px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  } as const,
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 40,
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
    textAlign: "center" as const,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: "linear-gradient(135deg, #1B2A4A, #0EA5E9)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    fontWeight: 700,
    margin: "0 auto 20px",
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "#111827",
    marginBottom: 8,
    marginTop: 0,
  } as const,
  store: {
    color: "#64748b",
    fontSize: 14,
    margin: "4px 0",
  } as const,
  message: {
    color: "#374151",
    fontSize: 14,
    lineHeight: 1.6,
    margin: "8px 0",
  } as const,
  hint: {
    color: "#94a3b8",
    fontSize: 13,
    margin: "8px 0 24px",
    lineHeight: 1.5,
  } as const,
  error: {
    color: "#EF4444",
    fontSize: 13,
    marginBottom: 16,
    background: "#FEF2F2",
    padding: "8px 12px",
    borderRadius: 8,
  } as const,
  input: {
    width: "100%",
    padding: "12px 16px",
    fontSize: 15,
    border: "1px solid #d1d5db",
    borderRadius: 10,
    outline: "none",
    boxSizing: "border-box" as const,
    marginBottom: 16,
  },
  button: {
    width: "100%",
    padding: "12px 24px",
    fontSize: 15,
    fontWeight: 600,
    border: "none",
    borderRadius: 10,
    background: "linear-gradient(135deg, #1B2A4A, #0EA5E9)",
    color: "#fff",
    cursor: "pointer",
  } as const,
  checkmark: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "#D1FAE5",
    color: "#10B981",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 24,
    fontWeight: 700,
    margin: "0 auto 20px",
  },
  backLink: {
    marginTop: 20,
    fontSize: 13,
  } as const,
};
