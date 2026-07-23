// TruCredit Dashboard — v3 Clean redesign
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, Link } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Button,
  Badge,
  Divider,
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

// ── KPI card — clean white card with colored accent border ──
type KpiTone = "default" | "success" | "warning" | "critical";

const kpiAccent: Record<KpiTone, { borderColor: string; iconBg: string }> = {
  default:  { borderColor: "transparent",                    iconBg: "var(--p-color-bg-fill-brand)" },
  success:  { borderColor: "var(--p-color-text-success)",    iconBg: "var(--p-color-bg-fill-success)" },
  warning:  { borderColor: "var(--p-color-text-caution)",    iconBg: "var(--p-color-bg-fill-caution)" },
  critical: { borderColor: "var(--p-color-text-critical)",   iconBg: "var(--p-color-bg-fill-critical)" },
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
  const a = kpiAccent[tone];
  return (
    <Box
      background="bg-surface"
      borderWidth="025"
      borderColor="border-secondary"
      borderRadius="200"
      padding="400"
      minWidth="160px"
      style={{
        flex: 1,
        borderLeftWidth: tone !== "default" ? "3px" : undefined,
        borderLeftStyle: tone !== "default" ? "solid" : undefined,
        borderLeftColor: tone !== "default" ? a.borderColor : undefined,
      }}
    >
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: a.iconBg,
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <BlockStack gap="050">
          <Text as="p" variant="headingLg" fontWeight="bold">
            {value}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {label}
          </Text>
        </BlockStack>
      </InlineStack>
    </Box>
  );
}

// ── AR Aging bar ──
function agingBarColor(label: string): string {
  if (label.includes("90"))   return "var(--p-color-bg-fill-critical)";
  if (label.includes("61"))   return "var(--p-color-bg-fill-critical)";
  if (label.includes("31"))   return "var(--p-color-bg-fill-caution)";
  if (label.includes("1"))    return "var(--p-color-bg-fill-brand)";
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
        <svg
          width="80" height="80" viewBox="0 0 80 80"
          role="img"
          aria-label={`${label} usage: ${Math.round(clamped)}% — ${used} of ${total}`}
        >
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

function CustomerCard({ customer }: { customer: { id: string; name: string; company?: string | null; status: string; creditGrade?: string | null } }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const initials = customerAvatarInitials(customer.name);
  const avatarBg = customerAvatarColor(customer.name);
  return (
      <div
        onClick={() => navigate(`/app/customers/${customer.id}`)}
        style={{
          cursor: "pointer",
          padding: "var(--p-space-400)",
          borderRadius: "var(--p-border-radius-200)",
          border: "1px solid var(--p-color-border-secondary)",
          background: "var(--p-color-bg-surface)",
          transition: "box-shadow 0.15s ease",
          boxShadow: hovered ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <div
            style={{
              width: 40, height: 40,
              borderRadius: "var(--p-border-radius-full)",
              background: avatarBg, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 600, flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <BlockStack gap="050" inlineAlign="start">
            <Text as="span" variant="bodyMd" fontWeight="bold" truncate>{customer.name}</Text>
            {customer.company && (
              <Text as="span" variant="bodySm" tone="subdued" truncate>{customer.company}</Text>
            )}
          </BlockStack>
        </InlineStack>
        <div style={{ marginTop: "var(--p-space-300)", display: "flex", gap: "var(--p-space-200)", flexWrap: "wrap" }}>
          {customer.creditGrade && (
            <Badge size="small">{customer.creditGrade.replace("_", "+")}</Badge>
          )}
          <Badge
            size="small"
            tone={
              customer.status === "ACTIVE" ? "success" :
              customer.status === "FROZEN" ? "warning" :
              customer.status === "INACTIVE" ? "attention" :
              "new"
            }
          >
            {customer.status}
          </Badge>
        </div>
      </div>
  );
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

                <BlockStack gap="400">
                  {aging.buckets.map((bucket) => {
                    const maxAmount = Math.max(...aging.buckets.map((b) => Number(b.totalAmount)), 1);
                    const pct = Math.round((Number(bucket.totalAmount) / maxAmount) * 100) || 2;
                    const color = agingBarColor(bucket.label);
                    return (
                      <BlockStack key={bucket.label} gap="100">
                        <InlineStack align="space-between" gap="200">
                          <InlineStack gap="200" blockAlign="center">
                            <Badge size="small" tone={agingBadgeTone(bucket.label)}>{bucket.label}</Badge>
                            <Text as="span" variant="bodySm">{bucket.count} inv</Text>
                          </InlineStack>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            ${Number(bucket.totalAmount).toLocaleString()}
                          </Text>
                        </InlineStack>
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
                      </BlockStack>
                    );
                  })}
                </BlockStack>

                <Divider />

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
            <BlockStack gap="500">
              {/* Active Tasks Counter */}
              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                <InlineStack gap="200" blockAlign="center">
                  <TargetIcon style={{ width: 20, height: 20, color: "var(--p-color-text-caution)" }} />
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">Active tasks</Text>
                    <Text as="span" variant="headingLg" fontWeight="bold">{collectionStats.activeTasks}</Text>
                  </BlockStack>
                </InlineStack>
                <Link to="/app/tasks" style={{ textDecoration: "none" }}>
                  <Text as="span" variant="bodySm" tone="success" fontWeight="medium">All tasks →</Text>
                </Link>
              </InlineStack>

              <Divider />

              {/* Quick Action Buttons */}
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm" tone="subdued">QUICK ACTIONS</Text>
                <InlineStack gap="300" wrap>
                  <Button url="/app/customers" icon={PersonAddIcon} variant="primary">View Customers</Button>
                  <Button url="/app/invoices/new" icon={OrderIcon}>Create Invoice</Button>
                  <Button url="/app/collections" icon={CalendarCheckIcon}>Collections</Button>
                </InlineStack>
              </BlockStack>
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
                    <Text as="p" variant="bodyMd" tone="subdued">Customers are synced from Shopify B2B companies. Go to the Customers page to trigger a sync.</Text>
                    <Button url="/app/customers" variant="primary">Go to Customers</Button>
                  </BlockStack>
                </Box>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                  {recentCustomers.map((c) => (
                    <CustomerCard key={c.id} customer={c} />
                  ))}
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
