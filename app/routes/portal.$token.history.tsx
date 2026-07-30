import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { getPortalPaymentHistory, validatePortalSession } from "~/services/portal.server";

const PAGE_SIZE = 20;

export async function loader({ params, request }: LoaderFunctionArgs) {
  const token = params.token;
  if (!token) throw new Response("Token required", { status: 400 });
  const session = await validatePortalSession(token);
  if (!session) throw new Response("Invalid or expired link", { status: 401 });

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);

  return getPortalPaymentHistory(session.shopId, session.customerId, page, PAGE_SIZE);
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function formatPaymentMethod(method: string | null): string {
  if (!method) return "—";
  const map: Record<string, string> = {
    credit_card: "Credit Card",
    bank_transfer: "Bank Transfer",
    wire: "Wire Transfer",
    ach: "ACH",
    check: "Check",
    cash: "Cash",
    draft_order: "Draft Order",
    other: "Other",
  };
  return map[method] ?? method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PortalPaymentHistory() {
  const { payments, total, page, totalPages } = useLoaderData<typeof loader>();

  const buildUrl = (p: number) => {
    if (p <= 1) return "?";
    return `?page=${p}`;
  };

  return (
    <div>
      <h2 className="portal-section-title">Payment History</h2>

      {payments.length === 0 ? (
        <div className="portal-empty">No payments recorded yet.</div>
      ) : (
        <>
          <div className="portal-summary">
            <span>{total} payment{total !== 1 ? "s" : ""}</span>
          </div>

          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Days to Pay</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((pmt) => (
                  <tr key={pmt.id}>
                    <td>{new Date(pmt.paidDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</td>
                    <td>#{pmt.invoiceNumber}</td>
                    <td>{formatPaymentMethod(pmt.paymentMethod)}</td>
                    <td>{formatCurrency(pmt.amount, pmt.currency)}</td>
                    <td>{pmt.daysToPay != null ? `${pmt.daysToPay}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="portal-pagination">
              <Link
                to={buildUrl(page - 1)}
                className={`portal-page-btn ${page <= 1 ? "portal-page-btn--disabled" : ""}`}
                aria-disabled={page <= 1}
              >
                Previous
              </Link>
              <span className="portal-page-info">Page {page} of {totalPages}</span>
              <Link
                to={buildUrl(page + 1)}
                className={`portal-page-btn ${page >= totalPages ? "portal-page-btn--disabled" : ""}`}
                aria-disabled={page >= totalPages}
              >
                Next
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
