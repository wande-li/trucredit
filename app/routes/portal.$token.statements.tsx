import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getPortalStatement, validatePortalSession } from "~/services/portal.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const token = params.token;
  if (!token) throw new Response("Token required", { status: 400 });
  const session = await validatePortalSession(token);
  if (!session) throw new Response("Invalid or expired link", { status: 401 });
  return getPortalStatement(session.shopId, session.customerId);
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
}

const AGING_BUCKETS = [
  { key: "current" as const, label: "Current", color: "#10b981" },
  { key: "days1to30" as const, label: "1–30 Days", color: "#f59e0b" },
  { key: "days31to60" as const, label: "31–60 Days", color: "#f97316" },
  { key: "days61to90" as const, label: "61–90 Days", color: "#ef4444" },
  { key: "days90plus" as const, label: "90+ Days", color: "#7c3aed" },
] as const;

export default function PortalStatement() {
  const { customer, shop, aging, totalOutstanding } = useLoaderData<typeof loader>();

  return (
    <div>
      <h2 className="portal-section-title">Account Statement</h2>

      {/* Customer summary */}
      <div className="portal-statement-card">
        <div className="portal-statement-meta">
          <strong>{customer.company || customer.name}</strong> — {shop.domain}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 20 }}>
          <div><div className="portal-kpi-label">Credit Limit</div><div className="portal-kpi-value" style={{ fontSize: 22 }}>{fmt(customer.creditLimit, shop.currency)}</div></div>
          <div><div className="portal-kpi-label">Available Credit</div><div className="portal-kpi-value" style={{ fontSize: 22, color: "#10b981" }}>{fmt(customer.creditAvailable, shop.currency)}</div></div>
        </div>
      </div>

      {/* AR Aging */}
      <h3 className="portal-section-title">AR Aging Summary</h3>

      {totalOutstanding === 0 ? (
        <div className="portal-empty" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, color: "#166534" }}>
          All clear — no outstanding invoices.
        </div>
      ) : (
        <>
          <div className="portal-aging-grid">
            {AGING_BUCKETS.map((b) => (
              <div key={b.key} className="portal-kpi-card">
                <div className="portal-aging-label">
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: b.color, marginRight: 6 }} />
                  {b.label}
                </div>
                <div className="portal-aging-value">{fmt(aging[b.key].total, shop.currency)}</div>
                <div className="portal-aging-count">{aging[b.key].count} invoice{aging[b.key].count !== 1 ? "s" : ""}</div>
              </div>
            ))}
          </div>

          <div className="portal-total-bar">
            <span className="portal-total-label">Total Outstanding</span>
            <span className="portal-total-value">{fmt(totalOutstanding, shop.currency)}</span>
          </div>
        </>
      )}
    </div>
  );
}
