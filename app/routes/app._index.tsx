// TruCredit Dashboard — v3 Clean redesign
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
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
  Banner,
  Divider,
} from "@shopify/polaris";
import {
  PersonAddIcon,
  OrderIcon,
  CalendarCheckIcon,
  GaugeIcon,
  TargetIcon,
  ChartLineIcon,
  CalendarIcon,
  CheckIcon,
  XIcon,
} from "@shopify/polaris-icons";
import { resolveShop } from "~/services/shop-resolver.server";
import prisma from "~/db.server";
import { getShopBilling, checkPlanAccess, hasFeature } from "~/services/billing.server";
import { getARAgingReport } from "~/services/invoice.server";
import { PLAN_FEATURES } from "~/lib/constants";
import { logger } from "~/services/logger.server";
import redis, { keys } from "~/lib/redis.server";
import OnboardingGuide from "~/components/OnboardingGuide";
import QuickTips from "~/components/QuickTips";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import PageSkeleton from "~/components/PageSkeleton";

export const meta: MetaFunction = () => [{ title: "TruCredit — Dashboard" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:app._index START");
  try {
    const { shopId } = await resolveShop(request);

    // P0-4: Dashboard Plan gate — prevent FREE users from accessing data
    const { isPaid, plan: currentPlan } = await checkPlanAccess(shopId);
    const showUpgradePrompt = !isPaid || currentPlan === "FREE" || currentPlan === "STARTER";

    // Plan feature checklist for dashboard
    const FEATURE_LABELS: Record<string, string> = {
      advancedCreditScoring: "Advanced credit scoring",
      aiEmailGeneration: "AI Email Generation",
      replyClassification: "Reply Classification",
      autoSequences: "Auto Sequences",
      customRules: "Custom Rules Engine",
      prioritySupport: "Priority Support",
    };
    const planFeatures = Object.entries(FEATURE_LABELS).map(([key, label]) => ({
      key,
      label,
      included: hasFeature(currentPlan, key as keyof typeof PLAN_FEATURES),
    }));

    // P2: Redis cache — avoid 9 DB queries on every dashboard load (TTL 30s)
    const cacheKey = keys.dashboardCache(shopId);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return json(JSON.parse(cached), {
          headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "Redis cache read failed — falling through to DB", msg);
    }

    // P1-4: Cache stampede protection — distributed lock when cache is cold
    const lockKey = keys.dashboardLock(shopId);
    let lockAcquired = false;
    try {
      lockAcquired = (await redis.set(lockKey, "1", "EX", 5, "NX")) === "OK";
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "Redis lock acquire failed — proceeding without lock", msg);
    }

    if (!lockAcquired) {
      // Another request is rebuilding — wait briefly then retry cache
      await new Promise((r) => setTimeout(r, 150));
      try {
        const retried = await redis.get(cacheKey);
        if (retried) {
          return json(JSON.parse(retried), {
            headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "Redis cache retry failed — falling through to DB", msg);
      }
    }

    // Eliminate duplicate shop read: getShopBilling already fetches shop + _count
    const billing = await getShopBilling(shopId);

    // Parallelize all remaining reads (7 queries) + eliminate separate shop.findUnique
    const [
      overdueInvoices,
      activeCustomers,
      frozenCustomers,
      agingReport,
      activeTasks,
      totalRules,
      recentCustomers,
      overdueTotal,
    ] = await Promise.all([
      prisma.invoice.count({ where: { shopId, status: "OVERDUE" } }),
      prisma.customer.count({ where: { shopId, status: "ACTIVE" } }),
      prisma.customer.count({ where: { shopId, isFrozen: true } }),
      getARAgingReport(shopId),
      prisma.collectionTask.count({
        where: {
          sequence: { shopId },
          status: { in: ["PENDING", "ACTIVE", "PAUSED", "ESCALATED"] },
        },
      }),
      prisma.creditRule.count({ where: { shopId } }),
      prisma.customer.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, company: true, creditGrade: true, status: true },
      }),
      prisma.invoice.aggregate({
        where: { shopId, status: "OVERDUE" },
        _sum: { amount: true },
      }),
    ]);

    const payload = {
      plan: billing.plan,
      planName: billing.planName,
      subscriptionStatus: billing.subscriptionStatus,
      currentPeriodEnd: billing.currentPeriodEnd ?? null,
      planFeatures,
      showUpgradePrompt,
      generatedAt: new Date().toISOString(),
      stats: {
        totalCustomers: billing.customerCount,
        totalInvoices: billing.invoiceCount,
        overdueInvoices,
        activeCustomers,
        frozenCustomers,
        overdueTotal: overdueTotal._sum.amount?.toString() ?? "0.00",
        activeTasks,
        totalRules,
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
    };

    // Cache for 30 seconds
    try {
      await redis.setex(cacheKey, 30, JSON.stringify(payload));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "Redis cache write failed — non-blocking", msg);
    }

    // Release lock if we hold it (non-blocking — TTL will expire otherwise)
    if (lockAcquired) {
      try {
        await redis.del(lockKey);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "Redis lock release failed — TTL will expire", msg);
      }
    }

    logger.app("INFO", "loader:app._index OK", null, {
      durationMs: Date.now() - t0,
      totalCustomers: payload.stats.totalCustomers,
      totalInvoices: payload.stats.totalInvoices,
      overdueInvoices: payload.stats.overdueInvoices,
    });
    return json(payload, {
      headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:app._index ERROR", msg, { durationMs: Date.now() - t0 });
    throw new Response("We encountered an issue. Please refresh the page and try again.", { status: 500 });
  }
};

// ── KPI card — Polaris-native Card with Shopify Admin dashboard style ──
type KpiTone = "default" | "success" | "warning" | "critical";

function KpiCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: KpiTone;
}) {
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      <Card padding="0">
        <div
          style={{
            borderTop: `2px solid ${
              tone === "success"  ? "var(--p-color-border-success)" :
              tone === "warning"  ? "var(--p-color-border-caution)" :
              tone === "critical" ? "var(--p-color-border-critical)" :
                                    "var(--p-color-border-brand)"
            }`,
          }}
        />
        <Box padding="400">
          <BlockStack gap="150">
            <Text as="p" variant="heading2xl" fontWeight="bold">
              {value}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {label}
            </Text>
          </BlockStack>
        </Box>
      </Card>
    </div>
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

// ── Plan Usage progress bar ──
function QuotaProgress({ pct, label, used, total }: { pct: number; label: string; used: number; total: number | string }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const tone = clamped >= 90 ? "critical" as const : clamped >= 70 ? "caution" as const : "success" as const;
  const barColor =
    tone === "critical" ? "var(--p-color-bg-fill-critical)"
    : tone === "caution" ? "var(--p-color-bg-fill-caution)"
    : "var(--p-color-bg-fill-success)";

  return (
    <BlockStack gap="100">
      <InlineStack align="space-between">
        <Text as="span" variant="bodySm" fontWeight="medium">{label}</Text>
        <Text as="span" variant="bodySm" tone="subdued">{used} / {total} ({Math.round(clamped)}%)</Text>
      </InlineStack>
      <div style={{ width: "100%", height: 8, background: "var(--p-color-bg-fill-tertiary)", borderRadius: 4 }}>
        <div style={{
          width: `${clamped}%`,
          height: "100%",
          background: barColor,
          borderRadius: 4,
          transition: "width 0.5s ease",
        }} />
      </div>
    </BlockStack>
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
  const { stats, quota, planName, subscriptionStatus, currentPeriodEnd, planFeatures, showUpgradePrompt, aging, collectionStats, recentCustomers, generatedAt } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Page fullWidth>
        <BlockStack gap="500">
          {/* ═══ Onboarding Guide ═══ */}
          {stats.totalCustomers === 0 && <OnboardingGuide />}

          {/* ═══ Plan alerts ═══ */}
          {/* Paid user over-quota warning (P1-5): quotaBlocked=false for paid plans, so surface a gentle alert */}
          {planName !== "FREE" && (quota.customerQuotaPercent > 100 || quota.invoiceQuotaPercent > 100) && (
            <Banner tone="warning" onDismiss={() => {}}>
              <Text as="p" variant="bodyMd">
                Your plan limits have been exceeded ({quota.customerQuotaPercent > 100 ? `${quota.customerCount} customers (limit: ${quota.customerQuota})` : ""}
                {quota.customerQuotaPercent > 100 && quota.invoiceQuotaPercent > 100 ? "; " : ""}
                {quota.invoiceQuotaPercent > 100 ? `${quota.invoiceCount} invoices (limit: ${quota.invoiceQuota})` : ""}
                ). Consider upgrading to a higher tier to avoid restrictions.
              </Text>
            </Banner>
          )}

          {/* FREE user upgrade prompt (P2-7) */}
          {showUpgradePrompt && !quota.needsUpgrade && (
            <Banner tone="info" action={{ content: "View Plans", url: "/app/billing" }}>
              <Text as="p" variant="bodyMd">
                You're on the Free plan. Upgrade to unlock automated collections, AI-powered emails, and more.
              </Text>
            </Banner>
          )}

          {/* P3: Last updated timestamp */}
          <Text as="p" variant="bodySm" tone="subdued" alignment="end">
            Last refreshed: {new Date(generatedAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>

          {/* ═══ KPI Row ═══ */}
          <InlineStack gap="400" wrap>
            <KpiCard label="Total Customers" value={stats.totalCustomers} />
            <KpiCard label="Active Customers" value={stats.activeCustomers} tone="success" />
            <KpiCard label="Frozen Accounts" value={stats.frozenCustomers} tone="warning" />
            <KpiCard label="Total Invoices" value={stats.totalInvoices} />
            <KpiCard label="Overdue Invoices" value={stats.overdueInvoices} tone="critical" />
            <KpiCard label="Overdue Amount" value={`$${Number(stats.overdueTotal).toLocaleString()}`} tone="critical" />
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
                  {aging.buckets.map((bucket: { label: string; count: number; totalAmount: string }) => {
                    const maxAmount = Math.max(...aging.buckets.map((b: { totalAmount: string }) => Number(b.totalAmount)), 1);
                    const pct = Math.round((Number(bucket.totalAmount) / maxAmount) * 100) || 2;
                    const color = agingBarColor(bucket.label);
                    return (
                      <BlockStack key={bucket.label} gap="100">
                        <InlineStack align="space-between" gap="200" blockAlign="center">
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
                {/* Header */}
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <GaugeIcon style={{ width: 20, height: 20, color: "var(--p-color-text-brand)" }} />
                    <Text as="h2" variant="headingMd">Plan Usage</Text>
                    <Badge tone={planName === "FREE" ? "info" : "success"}>{planName}</Badge>
                    {subscriptionStatus === "ACTIVE" && (
                      <InlineStack gap="100" blockAlign="center">
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--p-color-bg-fill-success)" }} />
                        <Text as="span" variant="bodySm" tone="subdued">Active</Text>
                      </InlineStack>
                    )}
                  </InlineStack>
                  <Button onClick={() => navigate("/app/billing")} variant="plain">Manage</Button>
                </InlineStack>

                {/* Subscription info */}
                {currentPeriodEnd && (
                  <Box padding="300" background="bg-fill-secondary" borderRadius="200">
                    <InlineStack gap="200" blockAlign="center">
                      <CalendarIcon style={{ width: 16, height: 16, color: "var(--p-color-text-subdued)" }} />
                      <Text as="span" variant="bodySm" tone="subdued">
                        {subscriptionStatus === "TRIAL" ? "Trial ends" : "Renews"}{" "}
                        {new Date(currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </Text>
                    </InlineStack>
                  </Box>
                )}

                {/* Feature checklist */}
                <Box padding="300" background="bg-fill-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" fontWeight="medium" tone="subdued">
                      Plan Features
                    </Text>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                      gap: "8px 16px",
                    }}>
                      {planFeatures.map((f) => (
                        <InlineStack key={f.key} gap="100" blockAlign="center">
                          {f.included ? (
                            <CheckIcon style={{ width: 14, height: 14, color: "var(--p-color-icon-success)" }} />
                          ) : (
                            <XIcon style={{ width: 14, height: 14, color: "var(--p-color-icon-subdued)" }} />
                          )}
                          <Text as="span" variant="bodySm" tone={f.included ? undefined : "subdued"}>
                            {f.label}
                          </Text>
                        </InlineStack>
                      ))}
                    </div>
                  </BlockStack>
                </Box>

                {/* Quota usage */}
                <BlockStack gap="300">
                  <Text as="span" variant="bodySm" fontWeight="medium" tone="subdued">Quota Usage</Text>
                  <QuotaProgress pct={quota.customerQuotaPercent} label="Customers" used={quota.customerCount} total={quota.customerQuota} />
                  <QuotaProgress pct={quota.invoiceQuotaPercent} label="Invoices" used={quota.invoiceCount} total={quota.invoiceQuota} />
                </BlockStack>

                {/* Upgrade CTA */}
                {quota.needsUpgrade && (
                  <Button onClick={() => navigate("/app/billing")} variant="primary" fullWidth>
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
                    <Text as="span" variant="bodySm" tone="subdued">Active Tasks</Text>
                    <Text as="span" variant="headingLg" fontWeight="bold">{collectionStats.activeTasks}</Text>
                  </BlockStack>
                </InlineStack>
                <Link to="/app/collections" style={{ textDecoration: "none" }}>
                  <Text as="span" variant="bodySm" tone="success" fontWeight="medium">All tasks →</Text>
                </Link>
              </InlineStack>

              <Divider />

              {/* Quick Action Buttons */}
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm" tone="subdued">QUICK ACTIONS</Text>
                <InlineStack gap="300" wrap>
                  <Button onClick={() => navigate("/app/customers")} icon={PersonAddIcon} variant="primary">View Customers</Button>
                  <Button onClick={() => navigate("/app/invoices/new")} icon={OrderIcon}>Create Invoice</Button>
                  <Button onClick={() => navigate("/app/collections")} icon={CalendarCheckIcon}>Collections</Button>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>

          {/* ═══ Quick Tips ═══ */}
          {stats.totalCustomers > 0 && (
            <QuickTips
              totalCustomers={stats.totalCustomers}
              totalInvoices={stats.totalInvoices}
              activeTasks={stats.activeTasks}
              totalRules={stats.totalRules}
            />
          )}

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
                    <Button onClick={() => navigate("/app/customers")} variant="primary">Go to Customers</Button>
                  </BlockStack>
                </Box>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                  {recentCustomers.map((c: { id: string; name: string; company?: string | null; creditGrade: string; status: string }) => (
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
