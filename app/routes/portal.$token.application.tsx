import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getPortalApplication, validatePortalSession } from "~/services/portal.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const token = params.token;
  if (!token) throw new Response("Token required", { status: 400 });
  const session = await validatePortalSession(token);
  if (!session) throw new Response("Invalid or expired link", { status: 401 });
  return getPortalApplication(session.shopId, session.customerId);
}

function fmt(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function badge(status: string) {
  const cls = (() => {
    switch (status) {
      case "ACTIVE": return "portal-badge--active";
      case "PENDING": return "portal-badge--pending";
      case "REJECTED": return "portal-badge--rejected";
      case "APPROVED": return "portal-badge--approved";
      default: return "portal-badge--inactive";
    }
  })();
  return <span className={`portal-badge ${cls}`}>{status}</span>;
}

function statusInfoBox(status: string) {
  const map: Record<string, { cls: string; title: string; msg: string }> = {
    PENDING: { cls: "portal-info-box--info", title: "Under Review", msg: "Your credit application is being reviewed. We'll notify you once a decision is made." },
    REJECTED: { cls: "portal-info-box--error", title: "Application Declined", msg: "Unfortunately your credit application was not approved at this time. Please contact the merchant for more details." },
    APPROVED: { cls: "portal-info-box--success", title: "Application Approved", msg: "Your credit application has been approved. Your credit account is now active." },
  };
  const info = map[status];
  if (!info) return null;
  return (
    <div className={`portal-info-box ${info.cls}`} role="alert">
      <strong>{info.title}:</strong> {info.msg}
    </div>
  );
}

export default function PortalApplication() {
  const { application, customer, shop } = useLoaderData<typeof loader>();

  // Branch 1: Active credit account — show limits
  if (customer && customer.status === "ACTIVE") {
    return (
      <div>
        <h2 className="portal-section-title">Credit Account</h2>

        <div className="portal-info-box portal-info-box--success" role="alert">
          Your credit account is <strong>active</strong>.
        </div>

        <div className="portal-app-grid">
          <div className="portal-app-card">
            <div className="portal-app-big-label">Credit Limit</div>
            <div className="portal-app-big-value">{fmt(customer.creditLimit, shop.currency)}</div>
          </div>
          <div className="portal-app-card">
            <div className="portal-app-big-label">Used</div>
            <div className="portal-app-big-value">{fmt(customer.creditUsed, shop.currency)}</div>
          </div>
          <div className="portal-app-card">
            <div className="portal-app-big-label">Available</div>
            <div className="portal-app-big-value" style={{ color: "#10b981" }}>{fmt(customer.creditAvailable, shop.currency)}</div>
          </div>
          <div className="portal-app-card">
            <div className="portal-app-big-label">Credit Grade</div>
            <div className="portal-app-big-value">{customer.creditGrade || "N/A"}</div>
          </div>
        </div>
      </div>
    );
  }

  // Branch 2: Application exists (pending/rejected) — show status
  if (application) {
    return (
      <div>
        <h2 className="portal-section-title">Credit Application</h2>
        {statusInfoBox(application.status)}

        <div className="portal-statement-card">
          <div className="portal-detail-row">
            <span className="portal-detail-label">Company</span>
            <span className="portal-detail-value">{application.companyName}</span>
          </div>
          <div className="portal-detail-row">
            <span className="portal-detail-label">Status</span>
            <span className="portal-detail-value">{badge(application.status)}</span>
          </div>
          <div className="portal-detail-row">
            <span className="portal-detail-label">Requested Credit</span>
            <span className="portal-detail-value">{fmt(application.requestedCredit)}</span>
          </div>
          {application.approvedLimit != null && (
            <div className="portal-detail-row">
              <span className="portal-detail-label">Approved Limit</span>
              <span className="portal-detail-value">{fmt(application.approvedLimit)}</span>
            </div>
          )}
          <div className="portal-detail-row">
            <span className="portal-detail-label">Submitted</span>
            <span className="portal-detail-value">
              {new Date(application.submittedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </span>
          </div>
          {application.reviewedAt && (
            <div className="portal-detail-row">
              <span className="portal-detail-label">Reviewed</span>
              <span className="portal-detail-value">
                {new Date(application.reviewedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Branch 3: No application — redirect to registration
  return (
    <div>
      <h2 className="portal-section-title">Credit Application</h2>
      <div className="portal-empty" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
        <p style={{ fontSize: 16, marginBottom: 8 }}>You haven't applied for credit yet.</p>
        <a href={`/register?shop=${shop.domain}`} className="portal-btn portal-btn-primary" style={{ maxWidth: 280, margin: "0 auto" }}>
          Apply for Net Terms
        </a>
      </div>
    </div>
  );
}
