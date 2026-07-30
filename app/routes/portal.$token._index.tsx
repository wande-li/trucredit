import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useOutletContext } from "@remix-run/react";
import type { PortalOutletContext } from "./portal.$token";
import { getPortalDashboard, validatePortalSession } from "~/services/portal.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const token = params.token;
  if (!token) throw new Response("Token required", { status: 400 });
  const session = await validatePortalSession(token);
  if (!session) throw new Response("Invalid or expired link", { status: 401 });
  return getPortalDashboard(session.shopId, session.customerId);
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
  if (status === "PARTIALLY_PAID") return <span className={`${base} portal-badge--partial`}>Partial</span>;
  if (status === "OVERDUE") return <span className={`${base} portal-badge--overdue`}>{daysOverdue}d overdue</span>;
  if (status === "DISPUTED") return <span className={`${base} portal-badge--disputed`}>Disputed</span>;
  return <span className={`${base} portal-badge--pending`}>Pending</span>;
}

export default function PortalDashboard() {
  const { customer, summary, shop, recentInvoices, recentPayments } = useLoaderData<typeof loader>();
  const { token } = useOutletContext<PortalOutletContext>();
  const base = `/portal/${token}`;
  const usedPercent = customer.creditLimit > 0 ? Math.min(100, (customer.creditUsed / customer.creditLimit) * 100) : 0;
  const meterColor = usedPercent > 80 ? "#ef4444" : usedPercent > 50 ? "#f59e0b" : "#10b981";

  return (
    <div>
      <h2 className="portal-section-title">Overview</h2>

      {/* KPI Cards */}
      <div className="portal-kpi-grid">
        <div className="portal-kpi-card">
          <div className="portal-kpi-label">Credit Limit</div>
          <div className="portal-kpi-value">{formatCurrency(customer.creditLimit, shop.currency)}</div>
        </div>
        <div className="portal-kpi-card">
          <div className="portal-kpi-label">Used</div>
          <div className="portal-kpi-value">{formatCurrency(customer.creditUsed, shop.currency)}</div>
          <div className="portal-credit-meter">
            <div style={{ width: `${usedPercent}%`, height: "100%", borderRadius: 4, background: meterColor, transition: "width 0.3s" }} />
          </div>
          <div className="portal-kpi-desc">{usedPercent.toFixed(0)}% of limit</div>
        </div>
        <div className="portal-kpi-card">
          <div className="portal-kpi-label">Available</div>
          <div className="portal-kpi-value" style={{ color: "#10b981" }}>{formatCurrency(customer.creditAvailable, shop.currency)}</div>
        </div>
        <div className="portal-kpi-card">
          <div className="portal-kpi-label">Credit Grade</div>
          <div className="portal-kpi-value">{customer.creditGrade || "N/A"}</div>
        </div>
      </div>

      {/* Outstanding Summary */}
      {summary.unpaidCount > 0 && (
        <div className="portal-section">
          <div className="portal-statement-card" style={{ background: summary.totalOverdue > 0 ? "#fef2f2" : "#fff", borderColor: summary.totalOverdue > 0 ? "#fecaca" : "#e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#1e293b" }}>
                {summary.unpaidCount} unpaid invoice{summary.unpaidCount !== 1 ? "s" : ""}
              </span>
              <span style={{ fontSize: 14, color: "#64748b" }}>
                Total outstanding: <strong>{formatCurrency(summary.totalOutstanding, shop.currency)}</strong>
              </span>
              {summary.overdueCount > 0 && (
                <span className="portal-badge portal-badge--overdue">{summary.overdueCount} overdue — {formatCurrency(summary.totalOverdue, shop.currency)}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Invoices + Recent Payments */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
        {/* Recent Invoices */}
        <div className="portal-section">
          <h3 className="portal-section-title">Recent Invoices</h3>
          {recentInvoices.length === 0 ? (
            <div className="portal-empty">No invoices yet.</div>
          ) : (
            <>
              <div className="portal-table-wrap">
                <table className="portal-table">
                  <thead>
                    <tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Due</th></tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>#{inv.invoiceNumber}</td>
                        <td>{formatCurrency(inv.amount, inv.currency)}</td>
                        <td>{statusBadge(inv.status, inv.daysOverdue)}</td>
                        <td>{new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="portal-link-end">
                <Link to={`${base}/invoices`} className="portal-link">View All</Link>
              </div>
            </>
          )}
        </div>

        {/* Recent Payments */}
        <div className="portal-section">
          <h3 className="portal-section-title">Recent Payments</h3>
          {recentPayments.length === 0 ? (
            <div className="portal-empty">No payments yet.</div>
          ) : (
            <>
              <div className="portal-table-wrap">
                <table className="portal-table">
                  <thead>
                    <tr><th>Invoice</th><th>Amount</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {recentPayments.map((pmt) => (
                      <tr key={pmt.id}>
                        <td>#{pmt.invoiceNumber}</td>
                        <td>{formatCurrency(pmt.amount, shop.currency)}</td>
                        <td>{new Date(pmt.paidDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="portal-link-end">
                <Link to={`${base}/history`} className="portal-link">View All</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
