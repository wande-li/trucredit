import type { MetaFunction } from "@remix-run/node";
import { useRouteError } from "@remix-run/react";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — TruCredit" },
];

export function ErrorBoundary() {
  const error = useRouteError();
  const msg = error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <PageShell title="Privacy Policy">
      <div style={styles.alert}>
        Failed to load Privacy Policy: {msg}
      </div>
    </PageShell>
  );
}

export default function PrivacyPolicy() {
  return (
    <PageShell title="Privacy Policy" subtitle="Last updated: July 21, 2026">
      <Section title="1. Introduction">
        <P>
          TruCredit (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;)
          provides a Shopify application that enables merchants to offer B2B
          net terms credit, manage invoices, and automate accounts receivable
          collections. This Privacy Policy explains how we collect, use,
          store, and protect information when you install and use our
          application.
        </P>
        <P>
          By installing TruCredit, you agree to the practices described in this policy.
        </P>
      </Section>

      <Section title="2. Information We Collect">
        <Subsection title="2.1 Information from Shopify (via authorized API access)">
          <P>When you install our app, we access the following data through Shopify&apos;s API:</P>
          <Ul>
            <Li><Strong>Store information</Strong>: Store name, domain, and locale settings</Li>
            <Li><Strong>Customer data</Strong>: Company name (from customer default address), email address, phone number, customer name — used to create and manage B2B credit accounts</Li>
            <Li><Strong>Order data</Strong>: Order details, total price, currency, and financial status — used to generate invoices and track payments</Li>
            <Li><Strong>Customer identifiers</Strong>: Shopify Customer IDs to link credit accounts, invoices, and collection activities</Li>
          </Ul>
        </Subsection>
        <Subsection title="2.2 Credit & Payment Data We Store">
          <P>To provide our core service, we store the following data:</P>
          <Ul>
            <Li><Strong>Credit information</Strong>: Credit limits, credit scores, credit usage amounts, and credit grades (calculated assessments based on payment history and order patterns)</Li>
            <Li><Strong>Invoice data</Strong>: Invoice numbers, amounts, currencies, issue dates, due dates, paid dates, and payment status</Li>
            <Li><Strong>Collection records</Strong>: Email communication records, collection step tracking, and AI-generated content for accounts receivable follow-ups</Li>
            <Li><Strong>Payment history</Strong>: Timestamps and records of credit events (credit usage, payments, adjustments)</Li>
          </Ul>
        </Subsection>
        <Subsection title="2.3 Information we do NOT collect">
          <P>We do <Strong>not</Strong> access, collect, or store:</P>
          <Ul>
            <Li>Payment method details (credit card numbers, bank account information)</Li>
            <Li>Customer browsing behavior or shopping cart data</Li>
            <Li>Any Protected Customer Data (PCD) beyond what is necessary for B2B credit operations</Li>
          </Ul>
        </Subsection>
      </Section>

      <Section title="3. How We Use Your Information">
        <P>We use the collected information solely to provide our service:</P>
        <Ul>
          <Li>Create and manage B2B customer credit accounts with custom credit limits</Li>
          <Li>Generate and manage invoices for net terms orders</Li>
          <Li>Calculate credit scores and grades based on payment history</Li>
          <Li>Automate accounts receivable collection workflows (email reminders at set intervals)</Li>
          <Li>Generate AI-powered collection email content tailored to each customer&apos;s stage</Li>
          <Li>Display credit utilization dashboards and AR aging reports within your admin panel</Li>
          <Li>Enforce credit rules at Shopify checkout (block orders exceeding credit limits)</Li>
          <Li>Track payment history and collection progress</Li>
        </Ul>
      </Section>

      <Section title="4. Third-Party Services">
        <P>
          To provide AI-powered collection email generation and email delivery, we use the following services:
        </P>
        <P><Strong>DeepSeek AI (deepseek.com)</Strong></P>
        <Ul>
          <Li><Strong>Data sent</Strong>: Customer name, company name, invoice number, outstanding amount, due date, and collection stage (e.g., &quot;7 days overdue&quot;)</Li>
          <Li><Strong>Purpose</Strong>: Generate contextually appropriate collection email content</Li>
          <Li><Strong>Data NOT sent</Strong>: Email addresses, full customer contact details, pricing data, or store credentials</Li>
          <Li>DeepSeek processes this data solely for response generation and does not retain your data for training purposes</Li>
        </Ul>
        <P><Strong>AWS SES (Amazon Simple Email Service)</Strong></P>
        <Ul>
          <Li><Strong>Data sent</Strong>: Customer email addresses, email subject lines, and email body content</Li>
          <Li><Strong>Purpose</Strong>: Deliver automated collection emails to your B2B customers</Li>
          <Li>AWS SES processes data in accordance with AWS&apos;s data processing agreement</Li>
        </Ul>
      </Section>

      <Section title="5. Data Storage and Security">
        <Ul>
          <Li>All data is transmitted over HTTPS (TLS 1.2+)</Li>
          <Li>Application data is stored on encrypted cloud infrastructure (Railway)</Li>
          <Li>We implement access controls to limit data access to essential operations only</Li>
          <Li>We do not sell, rent, or share your data with any third party for marketing or advertising purposes</Li>
          <Li>Customer credit data is isolated per store (strict tenant separation)</Li>
        </Ul>
      </Section>

      <Section title="6. Data Retention and Deletion">
        <Ul>
          <Li><Strong>Active accounts</Strong>: Your data is retained while the app remains installed on your store</Li>
          <Li><Strong>After uninstallation</Strong>: All merchant data (customers, invoices, credit records, email templates, and collection rules) is permanently deleted within 30 days of app removal</Li>
          <Li><Strong>Customer data requests</Strong>: Customers of your store may request access to, or deletion of, their personal data through Shopify&apos;s GDPR process. We respond via the &quot;Customers Data Request&quot; webhook with all stored data, and via the &quot;Customers Redact&quot; webhook by anonymizing all PII fields (email, name, phone, company)</Li>
          <Li><Strong>Shop data erasure</Strong>: Upon receiving Shopify&apos;s &quot;Shop Redact&quot; webhook (GDPR-mandated 48-hour processing window), we permanently delete all data associated with the shop, including all customer records, invoices, collection histories, credit rules, email templates, and sessions</Li>
        </Ul>
      </Section>

      <Section title="7. Your Rights">
        <P>Depending on your jurisdiction, you may have the following rights:</P>
        <Ul>
          <Li><Strong>Access</Strong>: Request a copy of the data we hold about your store</Li>
          <Li><Strong>Correction</Strong>: Request correction of inaccurate data</Li>
          <Li><Strong>Deletion</Strong>: Request deletion of your data at any time</Li>
          <Li><Strong>Portability</Strong>: Request your data in a machine-readable format</Li>
          <Li><Strong>Withdrawal of consent</Strong>: Uninstall the app at any time to withdraw consent</Li>
        </Ul>
        <Subsection title="For EU/EEA merchants (GDPR):">
          <P>
            We process your data based on legitimate interest (providing the
            B2B credit service you installed) and your consent (by installing
            the app). You may exercise any of the above rights by contacting
            us at the email below. Shopify&apos;s GDPR webhooks
            (customers/data_request, customers/redact, shop/redact) are
            fully supported for automated data access and erasure requests.
          </P>
        </Subsection>
        <Subsection title="For California merchants (CCPA):">
          <P>
            We do not sell personal information. You have the right to know
            what data we collect and to request its deletion.
          </P>
        </Subsection>
      </Section>

      <Section title="8. Shopify Compliance">
        <P>We comply with:</P>
        <Ul>
          <Li>Shopify&apos;s API Terms of Service</Li>
          <Li>Shopify&apos;s Partner Program Agreement</Li>
          <Li>Shopify&apos;s data protection requirements</Li>
          <Li>Shopify&apos;s mandatory GDPR webhook specifications (customers/data_request, customers/redact, shop/redact)</Li>
        </Ul>
        <P>
          We access only the minimum data scopes necessary to provide our
          service: read_orders, read_customers, read_draft_orders,
          write_draft_orders, write_orders, read_merchant_approved_accounts.
        </P>
      </Section>

      <Section title="9. Changes to This Policy">
        <P>
          We may update this Privacy Policy from time to time. If we make
          material changes, we will notify you through the app or via the
          email associated with your Shopify account. Continued use of the
          app after changes constitutes acceptance.
        </P>
      </Section>

      <Section title="10. Contact Us">
        <P>If you have questions about this Privacy Policy or wish to exercise your data rights:</P>
        <P><Strong>Email</Strong>:{" "}<A href={`mailto:${process.env.SUPPORT_EMAIL || "basekit.studio@gmail.com"}`}>{process.env.SUPPORT_EMAIL || "basekit.studio@gmail.com"}</A></P>
        <P><Strong>Response time</Strong>: We aim to respond to all inquiries within 24 hours.</P>
      </Section>
    </PageShell>
  );
}

// ─── Plain HTML Components (no Polaris dependency) ───

function PageShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "Inter, -apple-system, sans-serif", background: "#f6f6f7", color: "#202223", minHeight: "100vh", padding: 0, margin: 0 }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 14, color: "#6d7175", margin: "0 0 32px" }}>{subtitle}</p>}
        <div style={styles.card}>{children}</div>
        <p style={{ textAlign: "center", fontSize: 13, color: "#999", marginTop: 32 }}>
          &copy; {new Date().getFullYear()} TruCredit. All rights reserved.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 12px", color: "#1a1a2e" }}>{title}</h2>
      {children}
    </div>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 8px", color: "#333" }}>{title}</h3>
      {children}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 14, lineHeight: 1.7, color: "#4a4a4a", margin: "0 0 12px" }}>{children}</p>;
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong style={{ fontWeight: 600 }}>{children}</strong>;
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul style={{ margin: "8px 0 16px", paddingLeft: 20 }}>{children}</ul>;
}

function Li({ children }: { children: React.ReactNode }) {
  return <li style={{ fontSize: 14, lineHeight: 1.8, color: "#4a4a4a", marginBottom: 4 }}>{children}</li>;
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} style={{ color: "#008060", textDecoration: "none" }}>{children}</a>;
}

const styles = {
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 40,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  alert: {
    background: "#FFF4E5",
    borderRadius: 8,
    padding: 16,
    fontSize: 14,
    color: "#B98900",
  },
};
