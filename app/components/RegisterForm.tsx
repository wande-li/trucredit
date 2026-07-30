import { useFetcher } from "@remix-run/react";

export interface RegisterFormData {
  ok?: boolean;
  error?: string;
  message?: string;
  status?: string;
  creditLimit?: number;
  portalUrl?: string;
}

interface RegisterFormProps {
  shopDomain: string;
  lastResult?: RegisterFormData;
}

const F = {
  page: {
    maxWidth: 480,
    margin: "0 auto",
    padding: "32px 20px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#1a1a2e",
  } as React.CSSProperties,
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 32,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)",
  } as React.CSSProperties,
  logo: {
    fontSize: 24,
    fontWeight: 700,
    color: "#1a1a2e",
    marginBottom: 8,
    textAlign: "center" as const,
  } as React.CSSProperties,
  subtitle: {
    color: "#64748b",
    fontSize: 14,
    marginBottom: 24,
    textAlign: "center" as const,
  } as React.CSSProperties,
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
    marginBottom: 6,
  } as React.CSSProperties,
  input: {
    display: "block",
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    outline: "none",
    boxSizing: "border-box" as const,
    transition: "border-color 0.15s",
    backgroundColor: "#fff",
  } as React.CSSProperties,
  select: {
    display: "block",
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    outline: "none",
    boxSizing: "border-box" as const,
    backgroundColor: "#fff",
  } as React.CSSProperties,
  button: {
    display: "block",
    width: "100%",
    padding: "12px 16px",
    fontSize: 15,
    fontWeight: 600,
    color: "#fff",
    background: "#1a1a2e",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    transition: "background 0.15s",
  } as React.CSSProperties,
  successBox: {
    background: "#dcfce7",
    color: "#166534",
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 14,
    lineHeight: 1.5,
  } as React.CSSProperties,
  errorBox: {
    background: "#fee2e2",
    color: "#991b1b",
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 14,
  } as React.CSSProperties,
  infoBox: {
    background: "#dbeafe",
    color: "#1e40af",
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 14,
    lineHeight: 1.5,
  } as React.CSSProperties,
  fieldGroup: {
    marginBottom: 16,
  } as React.CSSProperties,
  link: {
    color: "#2563eb",
    textDecoration: "underline",
  } as React.CSSProperties,
  badge: (status: string) => {
    const map: Record<string, { bg: string; color: string }> = {
      APPROVED: { bg: "#dcfce7", color: "#166534" },
      PENDING: { bg: "#fef3c7", color: "#92400e" },
      REJECTED: { bg: "#fee2e2", color: "#991b1b" },
    };
    const s = map[status] ?? { bg: "#f1f5f9", color: "#475569" };
    return {
      display: "inline-block",
      padding: "4px 12px",
      borderRadius: 6,
      fontSize: 13,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
    } as React.CSSProperties;
  },
};

function getStoreUrl(shopDomain: string): string {
  return shopDomain.includes(".myshopify.com")
    ? shopDomain
    : `${shopDomain}.myshopify.com`;
}

export default function RegisterForm({ shopDomain }: RegisterFormProps) {
  const fetcher = useFetcher<RegisterFormData>();
  const isSubmitting = fetcher.state === "submitting";
  const ok = fetcher.data?.ok;
  const error = fetcher.data?.error;
  const message = fetcher.data?.message;
  const status = fetcher.data?.status;
  const creditLimit = fetcher.data?.creditLimit;
  const portalUrl = fetcher.data?.portalUrl;

  // Success view
  if (ok && message) {
    return (
      <div style={F.page}>
        <div style={F.card}>
          <div style={F.successBox}>
            <strong>
              {status === "APPROVED" ? "Application Approved!" : "Application Submitted!"}
            </strong>
            <br />
            {message}
            {creditLimit ? (
              <>
                {" "}
                Your credit limit: <strong>${creditLimit.toLocaleString()}</strong>.
              </>
            ) : null}
          </div>
          {status && (
            <div style={F.infoBox}>
              <strong>Status:</strong>{" "}
              <span style={F.badge(status)}>
                {status === "APPROVED"
                  ? "Approved"
                  : status === "PENDING"
                  ? "Pending Review"
                  : status === "REJECTED"
                  ? "Declined"
                  : status}
              </span>
            </div>
          )}
          {status === "APPROVED" && portalUrl && (
            <div style={{ ...F.infoBox, marginTop: 12, background: "#eff6ff", borderLeft: "4px solid #3b82f6" }}>
              <strong>Your Account Portal:</strong>{" "}
              <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={F.link}>
                {portalUrl}
              </a>
            </div>
          )}
          <p style={{ ...F.subtitle, marginTop: 16 }}>
            Return to{" "}
            <a href={`https://${getStoreUrl(shopDomain)}`} style={F.link}>
              {getStoreUrl(shopDomain)}
            </a>
          </p>
        </div>
      </div>
    );
  }

  // Form entry
  return (
    <div style={F.page}>
      <div style={F.card}>
        <div style={F.logo}>TruCredit</div>
        <div style={F.subtitle}>
          Apply for Net Terms at <strong>{getStoreUrl(shopDomain)}</strong>
        </div>

        {error && <div style={F.errorBox}>{error}</div>}

        <fetcher.Form method="post">
          <div style={F.fieldGroup}>
            <label style={F.label} htmlFor="companyName">
              Company Name
            </label>
            <input
              type="text"
              id="companyName"
              name="companyName"
              required
              style={F.input}
              placeholder="Acme Corp"
            />
          </div>

          <div style={F.fieldGroup}>
            <label style={F.label} htmlFor="contactEmail">
              Contact Email
            </label>
            <input
              type="email"
              id="contactEmail"
              name="contactEmail"
              required
              style={F.input}
              placeholder="billing@acmecorp.com"
            />
          </div>

          <div style={F.fieldGroup}>
            <label style={F.label} htmlFor="yearsInBusiness">
              Years in Business
            </label>
            <input
              type="number"
              id="yearsInBusiness"
              name="yearsInBusiness"
              required
              min={0}
              max={99}
              style={F.input}
              placeholder="5"
              defaultValue={0}
            />
          </div>

          <div style={F.fieldGroup}>
            <label style={F.label} htmlFor="companySize">
              Company Size
            </label>
            <select
              id="companySize"
              name="companySize"
              required
              style={F.select}
              defaultValue=""
            >
              <option value="" disabled>
                Select...
              </option>
              <option value="1-10">1-10 employees</option>
              <option value="11-50">11-50 employees</option>
              <option value="51-200">51-200 employees</option>
              <option value="201-500">201-500 employees</option>
              <option value="500+">500+ employees</option>
            </select>
          </div>

          <div style={F.fieldGroup}>
            <label style={F.label} htmlFor="annualRevenue">
              Annual Revenue ($)
            </label>
            <input
              type="number"
              id="annualRevenue"
              name="annualRevenue"
              required
              min={0}
              step={10000}
              style={F.input}
              placeholder="500000"
              defaultValue={0}
            />
          </div>

          <div style={F.fieldGroup}>
            <label style={F.label} htmlFor="requestedCredit">
              Requested Credit Limit ($)
            </label>
            <input
              type="number"
              id="requestedCredit"
              name="requestedCredit"
              required
              min={500}
              step={500}
              style={F.input}
              placeholder="5000"
              defaultValue={5000}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...F.button,
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {isSubmitting ? "Submitting..." : "Submit Application"}
          </button>
        </fetcher.Form>

        <p style={{ ...F.subtitle, marginTop: 20, marginBottom: 0 }}>
          Already have an account? Check your email for the portal link.
        </p>
      </div>
    </div>
  );
}
