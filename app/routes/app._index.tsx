// TruCredit Dashboard — v2 Redesign: icon-driven KPI tiles, gradient bars, action grid
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Button,
  Badge,
} from "@shopify/polaris";
import {
  PersonIcon,
  PersonFilledIcon,
  PersonLockFilledIcon,
  OrderFilledIcon,
  AlertTriangleIcon,
  CashDollarFilledIcon,
  PersonAddIcon,
  OrderIcon,
  CalendarCheckIcon,
  GaugeIcon,
  TargetIcon,
  ClipboardChecklistIcon,
  ChartLineIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { getShopBilling } from "~/services/billing.server";
import { getARAgingReport } from "~/services/invoice.server";
import { logger } from "~/services/logger.server";
import OnboardingGuide from "~/components/OnboardingGuide";
import QuickTips from "~/components/QuickTips";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import PageSkeleton from "~/components/PageSkeleton";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      include: {
        _count: { select: { customers: true, invoices: true } },
      },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    const [overdueInvoices, activeCustomers, frozenCustomers, billing, agingReport, activeTasks] =
      await Promise.all([
        prisma.invoice.count({ where: { shopId: shop.id, status: "OVERDUE" } }),
        prisma.customer.count({ where: { shopId: shop.id, status: "ACTIVE" } }),
        prisma.customer.count({ where: { shopId: shop.id, isFrozen: true } }),
        getShopBilling(shop.id),
        getARAgingReport(shop.id),
        prisma.collectionTask.count({
          where: {
            sequence: { shopId: shop.id },
            status: { in: ["PENDING", "ACTIVE", "PAUSED", "ESCALATED"] },
          },
        }),
      ]);

    const recentCustomers = await prisma.customer.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, company: true, creditGrade: true, status: true },
    });

    const overdueTotal = await prisma.invoice.aggregate({
      where: { shopId: shop.id, status: "OVERDUE" },
      _sum: { amount: true },
    });

    return json({
      plan: billing.plan,
      planName: billing.planName,
      subscriptionStatus: billing.subscriptionStatus,
      stats: {
        totalCustomers: shop._count.customers,
        totalInvoices: shop._count.invoices,
        overdueInvoices,
        activeCustomers,
        frozenCustomers,
        overdueTotal: overdueTotal._sum.amount?.toString() ?? "0.00",
      },
      quota: {
        customerQuotaPercent: billing.customerQuotaPercent,
        invoiceQuotaPercent: billing.invoiceQuotaPercent,
        customerCount: billing.customerCount,
        customerQuota: billing.customerQuota,
        invoiceCount: billing.invoiceCount,
        invoiceQuota: billing.invoiceQuota,
        needsUpgrade: billing.needsUpgrade,
      },
      aging: {
        totalOutstanding: agingReport.totalOutstanding,
        totalOverdue: agingReport.totalOverdue,
        dso: agingReport.dso,
        totalCustomers: agingReport.totalCustomers,
        buckets: agingReport.buckets.map((b) => ({
          label: b.label,
          count: b.count,
          totalAmount: b.totalAmount,
        })),
      },
      collectionStats: { activeTasks },
      recentCustomers,
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Dashboard loader failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

// ── Styling helpers ──
type KpiTone = "default" | "success" | "warning" | "critical";

const kpiPalette: Record<KpiTone, { bg: string; iconBg: string; iconColor: string; border: string }> = {
  default:   { bg: "var(--p-color-bg-surface)",             iconBg: "var(--p-color-bg-fill-brand-subdued)",  iconColor: "var(--p-color-text-brand)",       border: "var(--p-color-border-secondary)" },
  success:   { bg: "var(--p-color-bg-surface-success)",      iconBg: "var(--p-color-bg-fill-success)",         iconColor: "var(--p-color-text-success)",      border: "var(--p-color-border-success)" },
  warning:   { bg: "var(--p-color-bg-surface-caution)",      iconBg: "var(--p-color-bg-fill-caution)",         iconColor: "var(--p-color-text-caution)",      border: "var(--p-color-border-caution)" },
  critical:  { bg: "var(--p-color-bg-surface-critical)",     iconBg: "var(--p-color-bg-fill-critical)",        iconColor: "var(--p-color-text-critical)",     border: "var(--p-color-border-critical)" },
};

function KpiCard({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone?: KpiTone;
}) {
  const c = kpiPalette[tone];
  return (
    <div
      style={{
        background: c.bg,
        borderRadius: "var(--p-border-radius-300)",
        border: `1px solid ${c.border}`,
        minWidth: 170,
        flex: 1,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "var(--p-space-400)" }}>
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "var(--p-border-radius-200)",
              background: c.iconBg,
              color: c.iconColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <BlockStack gap="050">
            <Text as="p" variant="headingXl" fontWeight="bold">
              {value}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {label}
            </Text>
          </BlockStack>
        </InlineStack>
      </div>
    </div>
  );
}

// ── AR Aging bar ──
function agingBarColor(label: string): string {
  if (label.includes("90"))   return "var(--p-color-bg-fill-critical)";
  if (label.includes("61–90") || label.includes("61-90")) return "var(--p-color-bg-fill-caution)";
  if (label.includes("31–60") || label.includes("31-60")) return "#f59e0b";
  if (label.includes("1–30")  || label.includes("1-30"))  return "var(--p-color-bg-fill-brand)";
  return "var(--p-color-bg-fill-success)";
}

function agingBadgeTone(label: string): "critical" | "warning" | "attention" | "info" | "success" {
  if (label.includes("90"))   return "critical";
  if (label.includes("61"))   return "warning";
  if (label.includes("31"))   return "attention";
  if (label.includes("1"))    return "info";
  return "success";
}

// ── Plan Usage ring-style visual ──
function QuotaRing({ pct, label, used, total }: { pct: number; label: string; used: number; total: number | string }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const circumference = 2 * Math.PI * 32;
  const offset = circumference - (clamped / 100) * circumference;
  const tone = clamped >= 90 ? "critical" as const : clamped >= 70 ? "caution" as const : "success" as const;
  const strokeColor =
    tone === "critical" ? "var(--p-color-text-critical)" :
    tone === "caution"  ? "var(--p-color-text-caution)" :
                          "var(--p-color-text-success)";
  const trackColor = "var(--p-color-bg-fill-tertiary)";

  return (
    <InlineStack gap="300" blockAlign="center">
      <div style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}>
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="32" fill="none" stroke={trackColor} strokeWidth="6" />
          <circle
            cx="40" cy="40" r="32"
            fill="none"
            stroke={strokeColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 40 40)"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text as="span" variant="bodySm" fontWeight="bold" tone={tone}>
            {Math.round(clamped)}%
          </Text>
        </div>
      </div>
      <BlockStack gap="050">
        <Text as="span" variant="bodyMd" fontWeight="medium">{label}</Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {used} / {total}
        </Text>
      </BlockStack>
    </InlineStack>
  );
}

// ── Action Tile ──
function ActionTile({ icon, label, url, primary }: { icon: React.ReactNode; label: string; url: string; primary?: boolean }) {
  return (
    <Link to={url} style={{ textDecoration: "none", flex: 1, minWidth: 140 }}>
      <div
        style={{
          padding: "var(--p-space-400)",
          borderRadius: "var(--p-border-radius-200)",
          border: "1px solid var(--p-color-border-secondary)",
          background: primary ? "var(--p-color-bg-fill-brand)" : "var(--p-color-bg-surface)",
          display: "flex",
          alignItems: "center",
          gap: "var(--p-space-300)",
          cursor: "pointer",
          transition: "box-shadow 0.15s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--p-shadow-card-sm)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
        }}
      >
        <div style={{ color: primary ? "var(--p-color-text-on-color)" : "var(--p-color-text-brand)", flexShrink: 0, display: "flex" }}>
          {icon}
        </div>
        <Text as="span" variant="bodyMd" fontWeight="medium">
          <span style={primary ? { color: "var(--p-color-text-on-color)" } : undefined}>{label}</span>
        </Text>
      </div>
    </Link>
  );
}

// ── Recent Customer card ──
function customerAvatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0]![0]! + parts[1]![0]!).toUpperCase()
    : (parts[0]?.[0] ?? "?").toUpperCase();
}

function customerAvatarColor(name: string): string {
  const colors = ["#4f46e5", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be123c", "#ca8a04"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length] ?? "#4f46e5";
}

// ── Dashboard ──
export default function Dashboard() {
  const { stats, quota, planName, aging, collectionStats, recentCustomers } =
    useLoaderData<typeof loader>();

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Page fullWidth>
        <BlockStack gap="500">
          {/* ═══ Onboarding Guide ═══ */}
          {stats.totalCustomers === 0 && <OnboardingGuide />}

          {/* ═══ KPI Row ═══ */}
          <InlineStack gap="400" wrap>
            <KpiCard icon={<PersonIcon style={{ width: 22, height: 22 }} />} label="Total Customers" value={stats.totalCustomers} />
            <KpiCard icon={<PersonFilledIcon style={{ width: 22, height: 22 }} />} label="Active Customers" value={stats.activeCustomers} tone="success" />
            <KpiCard icon={<PersonLockFilledIcon style={{ width: 22, height: 22 }} />} label="Frozen Accounts" value={stats.frozenCustomers} tone="warning" />
            <KpiCard icon={<OrderFilledIcon style={{ width: 22, height: 22 }} />} label="Total Invoices" value={stats.totalInvoices} />
            <KpiCard icon={<AlertTriangleIcon style={{ width: 22, height: 22 }} />} label="Overdue Invoices" value={stats.overdueInvoices} tone="critical" />
            <KpiCard icon={<CashDollarFilledIcon style={{ width: 22, height: 22 }} />} label="Overdue Amount" value={`$${Number(stats.overdueTotal).toLocaleString()}`} tone="critical" />
          </InlineStack>

          {/* ═══ AR Aging + Plan Usage ═══ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* ── AR Aging Report ── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <ChartLineIcon style={{ width: 20, height: 20, color: "var(--p-color-text-brand)" }} />
                    <Text as="h2" variant="headingMd">AR Aging</Text>
                  </InlineStack>
                  <Link to="/app/invoices" style={{ textDecoration: "none" }}>
                    <Text as="span" variant="bodySm" tone="success" fontWeight="medium">Invoices →</Text>
                  </Link>
                </InlineStack>

                <BlockStack gap="250">
                  {aging.buckets.map((bucket) => {
                    const maxAmount = Math.max(...aging.buckets.map((b) => Number(b.totalAmount)), 1);
                    const pct = Math.round((Number(bucket.totalAmount) / maxAmount) * 100) || 2;
                    const color = agingBarColor(bucket.label);
                    return (
                      <div key={bucket.label}>
                        <InlineStack align="space-between" gap="200">
                          <InlineStack gap="200" blockAlign="center">
                            <Badge size="small" tone={agingBadgeTone(bucket.label)}>{bucket.label}</Badge>
                            <Text as="span" variant="bodySm">{bucket.count} inv</Text>
                          </InlineStack>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            ${Number(bucket.totalAmount).toLocaleString()}
                          </Text>
                        </InlineStack>
                        <div style={{ marginTop: 6 }}>
                          <div style={{ height: 6, width: "100%", background: "var(--p-color-bg-fill-tertiary)", borderRadius: 999 }}>
                            <div
                              style={{
                                height: 6,
                                width: `${pct}%`,
                                background: color,
                                borderRadius: 999,
                                transition: "width 0.5s ease",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </BlockStack>

                <div style={{ height: 1, background: "var(--p-color-border-secondary)" }} />

                {/* Summary */}
                <InlineStack gap="400" wrap>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">Outstanding</Text>
                    <Text as="span" variant="headingMd" fontWeight="bold">${Number(aging.totalOutstanding).toLocaleString()}</Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">Overdue</Text>
                    <Text as="span" variant="headingMd" fontWeight="bold" tone="critical">${Number(aging.totalOverdue).toLocaleString()}</Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">DSO</Text>
                    <Text as="span" variant="headingMd" fontWeight="bold">{aging.dso ?? "—"} d</Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">AR Customers</Text>
                    <Text as="span" variant="headingMd" fontWeight="bold">{aging.totalCustomers}</Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* ── Plan Usage ── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <GaugeIcon style={{ width: 20, height: 20, color: "var(--p-color-text-brand)" }} />
                    <Text as="h2" variant="headingMd">Plan Usage</Text>
                    <Badge tone={planName === "FREE" ? "info" : "success"}>{planName}</Badge>
                  </InlineStack>
                  <Button url="/app/billing" variant="plain">Manage</Button>
                </InlineStack>

                <BlockStack gap="500">
                  <QuotaRing pct={quota.customerQuotaPercent} label="Customers" used={quota.customerCount} total={quota.customerQuota} />
                  <QuotaRing pct={quota.invoiceQuotaPercent} label="Invoices" used={quota.invoiceCount} total={quota.invoiceQuota} />
                </BlockStack>

                {quota.needsUpgrade && (
                  <Button url="/app/billing" variant="primary" fullWidth>
                    Upgrade Plan
                  </Button>
                )}
              </BlockStack>
            </Card>
          </div>

          {/* ═══ Collections Overview + Quick Actions (merged) ═══ */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <ClipboardChecklistIcon style={{ width: 20, height: 20, color: "var(--p-color-text-brand)" }} />
                  <Text as="h2" variant="headingMd">Collections &amp; Quick Actions</Text>
                </InlineStack>
                <Link to="/app/tasks" style={{ textDecoration: "none" }}>
                  <Text as="span" variant="bodySm" tone="success" fontWeight="medium">All tasks →</Text>
                </Link>
              </InlineStack>

              <InlineStack gap="300" wrap>
                <div
                  style={{
                    background: "var(--p-color-bg-surface-caution)",
                    borderRadius: "var(--p-border-radius-200)",
                    border: "1px solid var(--p-color-border-caution)",
                    padding: "var(--p-space-300) var(--p-space-400)",
                    minWidth: 120,
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--p-space-300)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <TargetIcon style={{ width: 20, height: 20, color: "var(--p-color-text-caution)" }} />
                  </div>
                  <BlockStack gap="050">
                    <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">{collectionStats.activeTasks}</Text>
                    <Text as="p" variant="bodySm">Active tasks</Text>
                  </BlockStack>
                </div>

                <ActionTile icon={<PersonAddIcon style={{ width: 20, height: 20 }} />} label="Add Customer" url="/app/customers/new" primary />
                <ActionTile icon={<OrderIcon style={{ width: 20, height: 20 }} />} label="Create Invoice" url="/app/invoices/new" />
                <ActionTile icon={<CalendarCheckIcon style={{ width: 20, height: 20 }} />} label="Collections" url="/app/collections" />
              </InlineStack>
            </BlockStack>
          </Card>

          {/* ═══ Quick Tips ═══ */}
          {stats.totalCustomers > 0 && <QuickTips />}

          {/* ═══ Recent Customers ═══ */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Recent Customers</Text>
                <Link to="/app/customers" style={{ textDecoration: "none" }}>
                  <Text as="span" variant="bodySm" tone="success" fontWeight="medium">View all →</Text>
                </Link>
              </InlineStack>

              {recentCustomers.length === 0 ? (
                <Box padding="800">
                  <BlockStack gap="400" align="center">
                    <Text as="p" variant="bodyLg" tone="subdued">No customers yet</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">Sync customers from Shopify or add them manually.</Text>
                    <Button url="/app/customers/new" variant="primary">Add First Customer</Button>
                  </BlockStack>
                </Box>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                  {recentCustomers.map((c) => {
                    const initials = customerAvatarInitials(c.name);
                    const avatarBg = customerAvatarColor(c.name);
                    return (
                      <Link key={c.id} to={`/app/customers/${c.id}`} style={{ textDecoration: "none" }}>
                        <div
                          style={{
                            padding: "var(--p-space-400)",
                            borderRadius: "var(--p-border-radius-200)",
                            border: "1px solid var(--p-color-border-secondary)",
                            background: "var(--p-color-bg-surface)",
                            transition: "box-shadow 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--p-shadow-card-sm)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                          }}
                        >
                          <InlineStack gap="300" blockAlign="center" wrap={false}>
                            {/* Avatar */}
                            <div
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: "var(--p-border-radius-full)",
                                background: avatarBg,
                                color: "#fff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 14,
                                fontWeight: 600,
                                flexShrink: 0,
                              }}
                            >
                              {initials}
                            </div>
                            <BlockStack gap="050" inlineAlign="start">
                              <Text as="span" variant="bodyMd" fontWeight="bold" truncate>{c.name}</Text>
                              {c.company && (
                                <Text as="span" variant="bodySm" tone="subdued" truncate>{c.company}</Text>
                              )}
                            </BlockStack>
                          </InlineStack>
                          <div style={{ marginTop: "var(--p-space-300)", display: "flex", gap: "var(--p-space-200)", flexWrap: "wrap" }}>
                            {c.creditGrade && (
                              <Badge size="small">{c.creditGrade.replace("_", "+")}</Badge>
                            )}
                            <Badge
                              size="small"
                              tone={
                                c.status === "ACTIVE" ? "success" :
                                c.status === "FROZEN" ? "warning" :
                                c.status === "INACTIVE" ? "attention" :
                                "new"
                              }
                            >
                              {c.status}
                            </Badge>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    </div>
  );
}

// P2-9: Route-level ErrorBoundary
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

// P2-10: Route-level loading skeleton
export function HydrateFallback() {
  return <PageSkeleton />;
}
