// TruCredit — Buyer-facing invoice payment page (tokenized link)
// Public route: no authenticate.admin() — access via /pay/:token from collection emails
// Shows invoice detail + "Pay Now" → Shopify native checkout

import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { useLoaderData, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { validateToken } from "~/services/token.server";
import { getInvoiceForPayment } from "~/services/invoice.server";
import { logger } from "~/services/logger.server";
import PortalErrorBoundary from "~/components/PortalErrorBoundary";
import portalStyles from "~/styles/portal.css?url";

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
export const links = () => [
  { rel: "stylesheet", href: portalStyles },
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
export async function loader({ params }: LoaderFunctionArgs) {
  const { token } = params;
  if (!token) throw notFound("Missing payment token");

  // 1. Validate token
  const payload = await validateToken(token);
  if (!payload) throw notFound("Payment link has expired or is invalid");

  if (payload.scope !== "invoice_pay") {
    logger.app("WARN", "pay.$token — wrong token scope", undefined, { scope: payload.scope });
    throw notFound("Invalid payment link type");
  }

  // 2. Fetch invoice with ownership verification
  const result = await getInvoiceForPayment({
    invoiceId: payload.resourceId,
    shopId: payload.shopId,
    customerId: payload.customerId,
  });

  if (!result) {
    throw notFound("Invoice not found");
  }

  const { invoice, customer, shop } = result;

  // 3. Use Shopify native checkout URL (invoiceUrl from draft order)
  const shopifyCheckoutUrl: string | null = invoice.paymentUrl ?? null;

  return {
    invoice,
    customer,
    shop,
    shopifyCheckoutUrl,
    isPaid: invoice.status === "PAID",
  };
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------
export const meta: MetaFunction = () => [
  { title: "Invoice Payment — TruCredit" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PayInvoice() {
  const { invoice, customer, shop, shopifyCheckoutUrl, isPaid } = useLoaderData<typeof loader>();

  return (
    <div className="portal-container">
      <div className="portal-card">
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 className="portal-title" style={{ margin: 0 }}>Invoice</h1>
          <span style={{ fontSize: 14, fontWeight: 500, color: "#64748B", backgroundColor: "#F1F5F9", padding: "6px 14px", borderRadius: 8 }}>
            #{invoice.invoiceNumber}
          </span>
        </div>

        {/* Seller Info */}
        <div className="portal-field">
          <span className="portal-label">From</span>
          <span className="portal-value">{shop.shopDomain}</span>
        </div>

        {/* Buyer Info */}
        <div className="portal-field">
          <span className="portal-label">To</span>
          <span className="portal-value">
            {customer.company || customer.name}
          </span>
        </div>

        {/* Divider */}
        <div style={{ height: 1, backgroundColor: "#E2E8F0", margin: "20px 0" }} />

        {/* Amount */}
        <div className="portal-field">
          <span className="portal-label">Amount Due</span>
          <div className="portal-amount">
            {formatCurrency(Number(invoice.amount), invoice.currency)}
          </div>
        </div>

        {/* Due Date & Status */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Due Date</span>
            <span className="portal-value">
              {new Date(invoice.dueDate).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Status</span>
            <StatusBadge status={invoice.status} daysOverdue={invoice.daysOverdue} />
          </div>
        </div>

        {isPaid && (
          <div style={{ backgroundColor: "#D1FAE5", color: "#065F46", padding: "12px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, textAlign: "center", marginBottom: 16 }}>
            This invoice has been paid on{" "}
            {invoice.paidDate
              ? new Date(invoice.paidDate).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : "—"}
          </div>
        )}

        {/* Pay Now Button */}
        <div style={{ marginTop: 8 }}>
          {!isPaid && shopifyCheckoutUrl && (
            <a href={shopifyCheckoutUrl} className="portal-btn portal-btn-primary">
              Pay Now
            </a>
          )}
          {!isPaid && !shopifyCheckoutUrl && (
            <p style={{ fontSize: 14, color: "#64748B", textAlign: "center", margin: 0 }}>
              Please contact {shop.shopDomain} for payment instructions.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="portal-footer" style={{ paddingTop: 16, borderTop: "1px solid #E2E8F0" }}>
          <span>Powered by TruCredit — Secure payment via Shopify</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    if (error.status === 404 || error.status === 401) {
      return (
        <div className="portal-container">
          <div className="portal-card" style={{ textAlign: "center" }}>
            <h1 className="portal-title" style={{ marginBottom: 16 }}>
              {error.status === 404 ? "Link Expired or Invalid" : "Session Expired"}
            </h1>
            <p style={{ color: "#64748B", fontSize: 16, lineHeight: 1.6, margin: 0 }}>
              {error.status === 404
                ? "This payment link may have expired or the invoice is no longer available. Please check your latest collection email for an updated link."
                : "Your payment session has expired. Please use the latest link from your collection email."}
            </p>
          </div>
        </div>
      );
    }
    return <PortalErrorBoundary />;
  }

  return <PortalErrorBoundary />;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status, daysOverdue }: { status: string; daysOverdue: number }) {
  const colors: Record<string, { bg: string; text: string; label: string }> = {
    PENDING: { bg: "#FEF3C7", text: "#92400E", label: "Pending" },
    OVERDUE: { bg: "#FEE2E2", text: "#991B1B", label: `Overdue (${daysOverdue} days)` },
    PARTIALLY_PAID: { bg: "#DBEAFE", text: "#1E40AF", label: "Partially Paid" },
    PAID: { bg: "#D1FAE5", text: "#065F46", label: "Paid" },
    DISPUTED: { bg: "#F3E8FF", text: "#6B21A8", label: "Disputed" },
    VOID: { bg: "#E2E8F0", text: "#475569", label: "Void" },
  };

  const c = colors[status] || { bg: "#E2E8F0", text: "#475569", label: status };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 12px",
        borderRadius: 9999,
        fontSize: 13,
        fontWeight: 600,
        backgroundColor: c.bg,
        color: c.text,
      }}
    >
      {c.label}
    </span>
  );
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

function notFound(message: string): never {
  throw new Response(message, { status: 404, statusText: message });
}
