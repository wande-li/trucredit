// TruCredit Dashboard — AR Aging + plan quota + quick stats
// Redesigned: pure Polaris tokens, no hardcoded colors
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
  ProgressBar,
  Divider,
} from "@shopify/polaris";
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

// ── Polaris CSS custom property tokens for subtle stat card backgrounds ──
const statBg: Record<string, string> = {
  success:  "var(--p-color-bg-surface-success)",
  warning:  "var(--p-color-bg-surface-caution)",
  critical: "var(--p-color-bg-surface-critical)",
};

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "critical";
}) {
  const borderTone =
    tone === "success" ? "border-success" :
    tone === "warning" ? "border-caution" :
    tone === "critical" ? "border-critical" :
    "border-secondary";

  const textTone =
    tone === "success" ? "success" as const :
    tone === "warning" ? "caution" as const :
    tone === "critical" ? "critical" as const :
    undefined;

  return (
    <div style={{ background: statBg[tone] ?? "var(--p-color-bg-surface)", minWidth: 160 }}>
      <Box borderRadius="300" padding="400" borderWidth="025" borderColor={borderTone}>
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">
            {label}
          </Text>
          <Text as="p" variant="heading2xl" fontWeight="bold" tone={textTone}>
            {value}
          </Text>
        </BlockStack>
      </Box>
    </div>
  );
}

function progressTone(pct: number): "success" | "highlight" | "critical" {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "highlight";
  return "success";
}

export default function Dashboard() {
  const { stats, quota, planName, aging, collectionStats, recentCustomers } =
    useLoaderData<typeof loader>();

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Page fullWidth>
        <BlockStack gap="600">
          {/* ═══ Onboarding Guide (first-time users) ═══ */}
          {stats.totalCustomers === 0 && <OnboardingGuide />}

          {/* ═══ KPI Stat Cards ═══ */}
          <InlineStack gap="400" wrap>
            <StatCard label="Total Customers" value={stats.totalCustomers} />
            <StatCard label="Active Customers" value={stats.activeCustomers} tone="success" />
            <StatCard label="Frozen Accounts" value={stats.frozenCustomers} tone="warning" />
            <StatCard label="Total Invoices" value={stats.totalInvoices} />
            <StatCard label="Overdue Invoices" value={stats.overdueInvoices} tone="critical" />
            <StatCard
              label="Overdue Amount"
              value={`$${Number(stats.overdueTotal).toLocaleString()}`}
              tone="critical"
            />
          </InlineStack>

          {/* ═══ AR Aging + Plan Usage ═══ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* AR Aging Report */}
            <Card>
              <BlockStack gap="500">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">AR Aging Report</Text>
                  <Link to="/app/invoices" style={{ textDecoration: "none" }}>
                    <Text as="span" variant="bodySm" tone="success" fontWeight="medium">
                      View invoices →
                    </Text>
                  </Link>
                </InlineStack>

                {/* Aging buckets with visual bars */}
                <BlockStack gap="300">
                  {aging.buckets.map((bucket) => {
                    const maxAmount = Math.max(...aging.buckets.map((b) => Number(b.totalAmount)), 1);
                    const barWidth = Math.max((Number(bucket.totalAmount) / maxAmount) * 100, 2);
                    const isCritical = bucket.label.includes("90");
                    return (
                      <BlockStack key={bucket.label} gap="150">
                        <InlineStack align="space-between">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="medium">
                              {bucket.label}
                            </Text>
                            <Badge size="small" tone={isCritical ? "critical" : "info"}>
                              {`${bucket.count} inv`}
                            </Badge>
                          </InlineStack>
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight="semibold"
                            tone={isCritical ? "critical" : undefined}
                          >
                            ${Number(bucket.totalAmount).toLocaleString()}
                          </Text>
                        </InlineStack>
                        <div
                          style={{
                            height: 8,
                            width: `${barWidth}%`,
                            background: isCritical
                              ? "var(--p-color-bg-fill-critical)"
                              : "var(--p-color-bg-fill-brand)",
                            borderRadius: "var(--p-border-radius-full)",
                            transition: "width 0.4s ease",
                          }}
                        />
                      </BlockStack>
                    );
                  })}
                </BlockStack>

                <Divider />

                {/* Summary strip */}
                <InlineStack gap="400" wrap>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">Total Outstanding</Text>
                    <Text as="span" variant="headingMd" fontWeight="bold">
                      ${Number(aging.totalOutstanding).toLocaleString()}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">Total Overdue</Text>
                    <Text as="span" variant="headingMd" fontWeight="bold" tone="critical">
                      ${Number(aging.totalOverdue).toLocaleString()}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">DSO</Text>
                    <Text as="span" variant="headingMd" fontWeight="bold">
                      {aging.dso ?? "—"} days
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">Customers with AR</Text>
                    <Text as="span" variant="headingMd" fontWeight="bold">
                      {aging.totalCustomers}
                    </Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Plan Usage */}
            <Card>
              <BlockStack gap="500">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">Plan Usage</Text>
                    <Badge tone={planName === "FREE" ? "info" : "success"}>{planName}</Badge>
                    {quota.needsUpgrade && <Badge tone="warning">Near Limit</Badge>}
                  </InlineStack>
                  <Button url="/app/billing" variant="plain">Manage Plan</Button>
                </InlineStack>

                <BlockStack gap="400">
                  {/* Customer quota */}
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd" fontWeight="medium">Customers</Text>
                      <Text as="span" variant="bodySm" tone={quota.customerQuotaPercent >= 90 ? "critical" : "subdued"}>
                        {quota.customerCount} / {quota.customerQuota}
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={quota.customerQuotaPercent} tone={progressTone(quota.customerQuotaPercent)} />
                  </BlockStack>

                  {/* Invoice quota */}
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd" fontWeight="medium">Invoices</Text>
                      <Text as="span" variant="bodySm" tone={quota.invoiceQuotaPercent >= 90 ? "critical" : "subdued"}>
                        {quota.invoiceCount} / {quota.invoiceQuota}
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={quota.invoiceQuotaPercent} tone={progressTone(quota.invoiceQuotaPercent)} />
                  </BlockStack>
                </BlockStack>

                {quota.needsUpgrade && (
                  <Button url="/app/billing" variant="primary" fullWidth>
                    Upgrade Plan
                  </Button>
                )}
              </BlockStack>
            </Card>
          </div>

          {/* ═══ Collections Status + Quick Actions ═══ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Collections Overview */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Collections Status</Text>
                  <Link to="/app/tasks" style={{ textDecoration: "none" }}>
                    <Text as="span" variant="bodySm" tone="success" fontWeight="medium">
                      View tasks →
                    </Text>
                  </Link>
                </InlineStack>

                <InlineStack gap="400">
                  <BlockStack gap="100">
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="caution">
                      {collectionStats.activeTasks}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">Active Collection Tasks</Text>
                  </BlockStack>
                </InlineStack>

                <Divider />

                <InlineStack gap="300" wrap>
                  <Button url="/app/collections">Manage Sequences</Button>
                  <Button url="/app/tasks" variant="plain">View All Tasks</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Quick Actions */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Quick Actions</Text>
                <BlockStack gap="200">
                  <InlineStack gap="200" wrap>
                    <Button url="/app/customers/new" variant="primary">
                      Add Customer
                    </Button>
                    <Button url="/app/invoices/new">Create Invoice</Button>
                  </InlineStack>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Button url="/app/customers" variant="plain">
                    Manage Customers
                  </Button>
                  <Button url="/app/invoices" variant="plain">
                    View All Invoices
                  </Button>
                </BlockStack>
              </BlockStack>
            </Card>
          </div>

          {/* ═══ Quick Tips (returning users) ═══ */}
          {stats.totalCustomers > 0 && <QuickTips />}

          {/* ═══ Recent Customers ═══ */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Recent Customers</Text>
                <Link to="/app/customers" style={{ textDecoration: "none" }}>
                  <Text as="span" variant="bodySm" tone="success" fontWeight="medium">
                    View all →
                  </Text>
                </Link>
              </InlineStack>

              {recentCustomers.length === 0 ? (
                <Box padding="800">
                  <BlockStack gap="400" align="center">
                    <Text as="p" variant="bodyLg" tone="subdued">
                      No customers yet
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Sync customers from Shopify or add them manually.
                    </Text>
                    <Button url="/app/customers/new" variant="primary">
                      Add First Customer
                    </Button>
                  </BlockStack>
                </Box>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                  {recentCustomers.map((c) => (
                    <Link key={c.id} to={`/app/customers/${c.id}`} style={{ textDecoration: "none" }}>
                      <Box borderColor="border-secondary" borderWidth="025" borderRadius="200" padding="400">
                        <BlockStack gap="200">
                          <InlineStack gap="200" blockAlign="center" align="space-between">
                            <Text as="span" variant="bodyMd" fontWeight="bold" truncate>
                              {c.name}
                            </Text>
                            <Badge
                              size="small"
                              tone={
                                c.status === "ACTIVE" ? "success" :
                                c.status === "FROZEN" ? "warning" :
                                "new"
                              }
                            >
                              {c.status}
                            </Badge>
                          </InlineStack>
                          {c.company && (
                            <Text as="span" variant="bodySm" tone="subdued" truncate>
                              {c.company}
                            </Text>
                          )}
                          {c.creditGrade && (
                            <Badge size="small">{c.creditGrade.replace("_", "+")}</Badge>
                          )}
                        </BlockStack>
                      </Box>
                    </Link>
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
