import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useSearchParams } from "@remix-run/react";
import { getPortalInvoices, validatePortalSession } from "~/services/portal.server";

const PAGE_SIZE = 20;
const STATUS_FILTERS = ["ALL", "PENDING", "OVERDUE", "PAID", "PARTIALLY_PAID", "DISPUTED", "CANCELLED"] as const;

export async function loader({ params, request }: LoaderFunctionArgs) {
  const token = params.token;
  if (!token) throw new Response("Token required", { status: 400 });
  const session = await validatePortalSession(token);
  if (!session) throw new Response("Invalid or expired link", { status: 401 });

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "ALL";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);

  return getPortalInvoices(session.shopId, session.customerId, statusFilter, page, PAGE_SIZE);
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function statusBadge(status: string, daysOverdue: number) {
  const base = "portal-badge";
  if (status === "PAID") return <span className={`${base} portal-badge--paid`}>Paid</span>;
  if (status === "PARTIALLY_PAID") return <span className={`${base} portal-badge--partial`}>Partially Paid</span>;
  if (status === "OVERDUE") return <span className={`${base} portal-badge--overdue`}>{daysOverdue}d overdue</span>;
  if (status === "DISPUTED") return <span className={`${base} portal-badge--disputed`}>Disputed</span>;
  if (status === "CANCELLED") return <span className={`${base} portal-badge--inactive`}>Cancelled</span>;
  return <span className={`${base} portal-badge--pending`}>Pending</span>;
}

export default function PortalInvoices() {
  const { invoices, total, page, totalPages } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const currentFilter = searchParams.get("status") || "ALL";

  const buildUrl = (p: number, status?: string) => {
    const s = status ?? currentFilter;
    const params = new URLSearchParams();
    if (s !== "ALL") params.set("status", s);
    if (p > 1) params.set("page", String(p));
    return `?${params.toString()}`;
  };

  return (
    <div>
      <h2 className="portal-section-title">Invoices</h2>

      {/* Filters */}
      <div className="portal-filters">
        {STATUS_FILTERS.map((status) => (
          <Link
            key={status}
            to={status === "ALL" ? "?" : `?status=${status}`}
            className={currentFilter === status ? "portal-filter-btn portal-filter-btn--active" : "portal-filter-btn"}
          >
            {status === "ALL" ? "All" : status.replace(/_/g, " ")}
          </Link>
        ))}
      </div>

      {invoices.length === 0 ? (
        <div className="portal-empty">
          {currentFilter === "ALL"
            ? "All caught up — no invoices yet."
            : `No ${currentFilter.replace(/_/g, " ").toLowerCase()} invoices found.`}
        </div>
      ) : (
        <>
          <div className="portal-summary">
            <span>{total} invoice{total !== 1 ? "s" : ""}</span>
          </div>

          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Due Date</th>
                  <th>Terms</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>#{inv.invoiceNumber}</td>
                    <td>{formatCurrency(inv.amount, inv.currency)}</td>
                    <td>{statusBadge(inv.status, inv.daysOverdue)}</td>
                    <td>{new Date(inv.dueDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</td>
                    <td>{inv.netTermsDays ? `Net ${inv.netTermsDays}` : "—"}</td>
                    <td>
                      {inv.status !== "PAID" && inv.paymentUrl && (
                        <a href={inv.paymentUrl} className="portal-pay-btn">Pay Now</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
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
