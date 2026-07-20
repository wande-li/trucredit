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
  try {
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
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new Response(`Failed to load data: ${msg}`, { status: 500 });
  }
};

function progressTone(pct: number): "success" | "highlight" | "critical" {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "highlight";
  return "success";
}

const statCardStyle = (tone?: "critical" | "warning" | "success"): React.CSSProperties => ({
  background: tone
    ? `var(--p-color-bg-${tone}-strong)`
    : "var(--p-color-bg-surface)",
  borderRadius: 10,
  padding: "24px 28px",
  flex: "1 1 160px",
  minWidth: 160,
  boxShadow: tone
    ? undefined
    : "0 1px 3px rgba(0,0,0,0.06)",
  border: tone ? undefined : "1px solid var(--p-color-border-secondary)",
});

const statLabelStyle = (tone?: string): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 500,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: tone ? "var(--p-color-text-on-color)" : "var(--p-color-text-subdued)",
  marginBottom: 8,
});

const statValueStyle = (tone?: string): React.CSSProperties => ({
  fontSize: 28,
  fontWeight: 700,
  color: tone ? "var(--p-color-text-on-color)" : "var(--p-color-text)",
  lineHeight: 1.2,
});

export default function Dashboard() {
  const { stats, quota, planName, aging, collectionStats, recentCustomers } =
    useLoaderData<typeof loader>();

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
    <Page fullWidth>
      <BlockStack gap="600">
        {/* ── KPI Stat Cards Row ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 20,
          }}
        >
          <div style={statCardStyle()}>
            <div style={statLabelStyle()}>Total Customers</div>
            <div style={statValueStyle()}>{stats.totalCustomers}</div>
          </div>
          <div style={statCardStyle("success")}>
            <div style={statLabelStyle("success")}>Active</div>
            <div style={statValueStyle("success")}>{stats.activeCustomers}</div>
          </div>
          <div style={statCardStyle("warning")}>
            <div style={statLabelStyle("warning")}>Frozen</div>
            <div style={statValueStyle("warning")}>{stats.frozenCustomers}</div>
          </div>
          <div style={statCardStyle()}>
            <div style={statLabelStyle()}>Total Invoices</div>
            <div style={statValueStyle()}>{stats.totalInvoices}</div>
          </div>
          <div style={statCardStyle("critical")}>
            <div style={statLabelStyle("critical")}>Overdue</div>
            <div style={statValueStyle("critical")}>{stats.overdueInvoices}</div>
          </div>
          <div style={statCardStyle("critical")}>
            <div style={statLabelStyle("critical")}>Overdue Total</div>
            <div style={statValueStyle("critical")}>
              ${Number(stats.overdueTotal).toLocaleString()}
            </div>
          </div>
        </div>

        {/* ── Row 2: AR Aging + Plan Quota ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
        >
          {/* AR Aging */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  AR Aging
                </Text>
                <Link to="/app/invoices">
                  <Text as="span" variant="bodySm" tone="subdued">
                    View all →
                  </Text>
                </Link>
              </InlineStack>
              <InlineStack gap="300" wrap>
                {aging.buckets.map((bucket) => (
                  <Box key={bucket.label} minWidth="100px">
                    <BlockStack gap="050">
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
                        {bucket.count} inv
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
              </InlineStack>
              <div
                style={{
                  height: 1,
                  background: "var(--p-color-border-secondary)",
                  margin: "4px 0",
                }}
              />
              <InlineStack gap="400" wrap>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Outstanding
                  </Text>
                  <Text as="span" variant="headingMd" fontWeight="bold">
                    ${Number(aging.totalOutstanding).toLocaleString()}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Overdue
                  </Text>
                  <Text
                    as="span"
                    variant="headingMd"
                    fontWeight="bold"
                    tone="critical"
                  >
                    ${Number(aging.totalOverdue).toLocaleString()}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    DSO
                  </Text>
                  <Text as="span" variant="headingMd" fontWeight="bold">
                    {aging.dso ?? "—"} days
                  </Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Plan Quota */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Plan
                  </Text>
                  <Badge tone="info">{planName}</Badge>
                  {quota.needsUpgrade && (
                    <Badge tone="warning">Upgrade Available</Badge>
                  )}
                </InlineStack>
                <Button url="/app/billing" variant="plain">
                  Manage
                </Button>
              </InlineStack>
              <BlockStack gap="300">
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd" fontWeight="medium">
                      Customers
                    </Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={quota.customerQuotaPercent >= 90 ? "critical" : "subdued"}
                    >
                      {quota.customerCount} / {quota.customerQuota}
                    </Text>
                  </InlineStack>
                  <ProgressBar
                    progress={quota.customerQuotaPercent}
                    tone={progressTone(quota.customerQuotaPercent)}
                  />
                </BlockStack>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd" fontWeight="medium">
                      Invoices
                    </Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={quota.invoiceQuotaPercent >= 90 ? "critical" : "subdued"}
                    >
                      {quota.invoiceCount} / {quota.invoiceQuota}
                    </Text>
                  </InlineStack>
                  <ProgressBar
                    progress={quota.invoiceQuotaPercent}
                    tone={progressTone(quota.invoiceQuotaPercent)}
                  />
                </BlockStack>
              </BlockStack>
              {quota.needsUpgrade && (
                <Button url="/app/billing" tone="success">
                  Upgrade Plan
                </Button>
              )}
            </BlockStack>
          </Card>
        </div>

        {/* ── Row 3: Collections + Quick Actions ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
        >
          {/* Collections */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Collections
                </Text>
                <Link to="/app/tasks">
                  <Text as="span" variant="bodySm" tone="subdued">
                    View tasks →
                  </Text>
                </Link>
              </InlineStack>
              <div style={statCardStyle("warning")}>
                <div style={statLabelStyle("warning")}>Active Tasks</div>
                <div style={statValueStyle("warning")}>
                  {collectionStats.activeTasks}
                </div>
              </div>
              <InlineStack gap="300" wrap>
                <Button url="/app/collections">Sequences</Button>
                <Button url="/app/tasks">All Tasks</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Quick Actions */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Quick Actions
              </Text>
              <BlockStack gap="200">
                <Button url="/app/customers" fullWidth>
                  Manage Customers
                </Button>
                <Button url="/app/customers/new" fullWidth>
                  Add Customer
                </Button>
                <Button url="/app/invoices" fullWidth>
                  View Invoices
                </Button>
              </BlockStack>
            </BlockStack>
          </Card>
        </div>

        {/* ── Recent Customers ── */}
        <Card>
          <BlockStack gap="400">
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
              <Box padding="400">
                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                  No customers yet. Sync from Shopify to get started.
                </Text>
              </Box>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 16,
                }}
              >
                {recentCustomers.map((c) => (
                  <Link
                    key={c.id}
                    to={`/app/customers/${c.id}`}
                    style={{ textDecoration: "none" }}
                  >
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
                            <Badge size="small">
                              {c.creditGrade.replace("_", "+")}
                            </Badge>
                          )}
                          <Badge
                            size="small"
                            tone={
                              c.status === "ACTIVE"
                                ? "success"
                                : c.status === "FROZEN"
                                  ? "warning"
                                  : "new"
                            }
                          >
                            {c.status}
                          </Badge>
                        </InlineStack>
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
