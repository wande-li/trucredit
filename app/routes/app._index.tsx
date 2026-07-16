// TruCredit Dashboard — AR Aging + plan quota + quick stats
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
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { getShopBilling } from "~/services/billing.server";
import { getARAgingReport } from "~/services/invoice.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop.trim();

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      _count: {
        select: { customers: true, invoices: true },
      },
    },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const [overdueInvoices, activeCustomers, frozenCustomers, billing, agingReport, activeTasks] =
    await Promise.all([
      prisma.invoice.count({
        where: { shopId: shop.id, status: "OVERDUE" },
      }),
      prisma.customer.count({
        where: { shopId: shop.id, status: "ACTIVE" },
      }),
      prisma.customer.count({
        where: { shopId: shop.id, isFrozen: true },
      }),
      getShopBilling(shop.id),
      getARAgingReport(shop.id),
      prisma.collectionTask.count({
        where: {
          sequence: { shopId: shop.id },
          status: { in: ["PENDING", "ACTIVE", "PAUSED", "ESCALATED"] },
        },
      }),
    ]);

  // Recent customers
  const recentCustomers = await prisma.customer.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      name: true,
      company: true,
      creditGrade: true,
      status: true,
    },
  });

  // Overdue total amount
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
    collectionStats: {
      activeTasks,
    },
    recentCustomers,
  });
};

function progressTone(pct: number): "success" | "highlight" | "critical" {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "highlight";
  return "success";
}

export default function Dashboard() {
  const { stats, quota, planName, aging, collectionStats, recentCustomers } =
    useLoaderData<typeof loader>();

  const statCards = [
    { label: "Total Customers", value: stats.totalCustomers },
    { label: "Active", value: stats.activeCustomers },
    { label: "Frozen", value: stats.frozenCustomers },
    { label: "Total Invoices", value: stats.totalInvoices },
    { label: "Overdue", value: stats.overdueInvoices },
    {
      label: "Overdue Total",
      value: `$${Number(stats.overdueTotal).toLocaleString()}`,
    },
  ];

  return (
    <Page title="Dashboard">
      <BlockStack gap="400">
        {/* Plan Quota Summary */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Plan: {planName}
                </Text>
                {quota.needsUpgrade && (
                  <Badge tone="warning">Upgrade Available</Badge>
                )}
              </InlineStack>
              <Button url="/app/billing" variant="plain">
                Manage Plan
              </Button>
            </InlineStack>

            <InlineStack gap="400" wrap>
              <Box minWidth="240px" maxWidth="360px">
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd">
                      Customers ({quota.customerCount} / {quota.customerQuota})
                    </Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={
                        quota.customerQuotaPercent >= 90
                          ? "critical"
                          : "subdued"
                      }
                    >
                      {quota.customerQuotaPercent}%
                    </Text>
                  </InlineStack>
                  <ProgressBar
                    progress={quota.customerQuotaPercent}
                    tone={progressTone(quota.customerQuotaPercent)}
                  />
                </BlockStack>
              </Box>

              <Box minWidth="240px" maxWidth="360px">
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd">
                      Invoices ({quota.invoiceCount} / {quota.invoiceQuota})
                    </Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={
                        quota.invoiceQuotaPercent >= 90
                          ? "critical"
                          : "subdued"
                      }
                    >
                      {quota.invoiceQuotaPercent}%
                    </Text>
                  </InlineStack>
                  <ProgressBar
                    progress={quota.invoiceQuotaPercent}
                    tone={progressTone(quota.invoiceQuotaPercent)}
                  />
                </BlockStack>
              </Box>
            </InlineStack>

            {quota.needsUpgrade && (
              <Button url="/app/billing" tone="success">
                Upgrade Plan
              </Button>
            )}
          </BlockStack>
        </Card>

        {/* AR Aging Snapshot */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                AR Aging
              </Text>
              <Link to="/app/invoices">
                <Text as="span" variant="bodySm" tone="subdued">
                  View all invoices →
                </Text>
              </Link>
            </InlineStack>

            <InlineStack gap="300" wrap>
              {aging.buckets.map((bucket) => (
                <Box key={bucket.label} minWidth="130px">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {bucket.label}
                    </Text>
                    <Text
                      as="p"
                      variant="headingLg"
                      fontWeight="bold"
                      tone={bucket.label === "90+ Days" ? "critical" : undefined}
                    >
                      ${Number(bucket.totalAmount).toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {bucket.count} invoice{bucket.count !== 1 ? "s" : ""}
                    </Text>
                  </BlockStack>
                </Box>
              ))}
            </InlineStack>

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
                <Text as="span" variant="bodySm" tone="subdued">Customers</Text>
                <Text as="span" variant="headingMd" fontWeight="bold">
                  {aging.totalCustomers}
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Collection Status */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Collections
              </Text>
              <Link to="/app/tasks">
                <Text as="span" variant="bodySm" tone="subdued">
                  View all tasks →
                </Text>
              </Link>
            </InlineStack>
            <InlineStack gap="400" wrap>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">
                  Active Tasks
                </Text>
                <Text as="span" variant="headingMd" fontWeight="bold">
                  {collectionStats.activeTasks}
                </Text>
              </BlockStack>
            </InlineStack>
            <InlineStack gap="300" wrap>
              <Button url="/app/collections">Manage Sequences</Button>
              <Button url="/app/tasks">View Tasks</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Stats Grid */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Overview
            </Text>
            <InlineStack gap="400" wrap>
              {statCards.map((stat) => (
                <Box key={stat.label} minWidth="130px">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {stat.label}
                    </Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {stat.value}
                    </Text>
                  </BlockStack>
                </Box>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

        <InlineStack gap="400" blockAlign="start" wrap>
          {/* Quick Links */}
          <Box minWidth="280px" maxWidth="400px">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Quick Actions
                </Text>
                <InlineStack gap="300" wrap>
                  <Button url="/app/customers">Manage Customers</Button>
                  <Button url="/app/customers/new">Add Customer</Button>
                  <Button url="/app/invoices">View Invoices</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Box>

          {/* Recent Customers */}
          <Box minWidth="280px" maxWidth="400px">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Recent Customers
                  </Text>
                  <Link to="/app/customers">
                    <Text as="span" variant="bodySm" tone="subdued">
                      View all →
                    </Text>
                  </Link>
                </InlineStack>
                {recentCustomers.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No customers yet. Sync from Shopify to get started.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    {recentCustomers.map((c) => (
                      <Link key={c.id} to={`/app/customers/${c.id}`}>
                        <Box
                          borderColor="border-secondary"
                          borderWidth="025"
                          borderRadius="200"
                          padding="300"
                        >
                          <BlockStack gap="100">
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {c.name}
                            </Text>
                            {c.company && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {c.company}
                              </Text>
                            )}
                            <InlineStack gap="200">
                              {c.creditGrade && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  Grade: {c.creditGrade.replace("_", "+")}
                                </Text>
                              )}
                              <Text as="span" variant="bodySm" tone="subdued">
                                {c.status}
                              </Text>
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      </Link>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Box>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
