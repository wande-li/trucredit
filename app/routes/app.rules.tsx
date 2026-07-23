// Credit Rules — list page
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  IndexTable,
  Badge,
  Box,
  EmptyState,
  Banner,
  Pagination,
} from "@shopify/polaris";
import { useCallback, useEffect, useRef, useState } from "react";
import { authenticate } from "~/shopify.server";
import { listRules, toggleRule, deleteRule } from "~/services/credit-rule.server";
import prisma from "~/db.server";
import type { CreditAction } from "@prisma/client";
import { logger } from "~/services/logger.server";
import { checkPlanAccess } from "~/services/billing.server";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import PageSkeleton from "~/components/PageSkeleton";

const ACTION_LABELS: Record<CreditAction, string> = {
  SET_LIMIT: "Set Limit",
  ADJUST_LIMIT: "Adjust Limit",
  FREEZE: "Freeze",
  SET_GRADE: "Set Grade",
  SET_TERMS: "Set Terms",
};

const ACTION_TONE: Record<CreditAction, "success" | "critical" | "warning" | "new"> = {
  SET_LIMIT: "new",
  ADJUST_LIMIT: "warning",
  FREEZE: "critical",
  SET_GRADE: "success",
  SET_TERMS: "warning",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Response("Shop not found", { status: 404 });

    const { isPaid } = await checkPlanAccess(shop.id);
    if (!isPaid) return redirect("/app/billing");

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const showInactive = url.searchParams.get("inactive") === "1";

    const result = await listRules({
      shopId: shop.id,
      isActive: showInactive ? undefined : true,
      page,
    });

    return json({ result, shopDomain, showInactive });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Rules loader failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Response("Shop not found", { status: 404 });

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();
    const ruleId = formData.get("ruleId")?.toString();

    if (!ruleId) return json({ error: "Rule ID required" }, { status: 400 });

    // Verify rule belongs to shop
    const rule = await prisma.creditRule.findFirst({
      where: { id: ruleId, shopId: shop.id },
    });
    if (!rule) return json({ error: "Rule not found" }, { status: 404 });

    switch (intent) {
      case "toggle": {
        const isActive = formData.get("isActive") === "true";
        await toggleRule({ shopId: shop.id, ruleId, isActive });
        return json({ success: true });
      }
      case "delete": {
        await deleteRule(shop.id, ruleId);
        return json({ success: true });
      }
      default:
        return json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Rule action failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

// ─── Conditions Summary Formatter ────────────────────────

function formatConditions(conditions: unknown): string {
  if (!conditions || typeof conditions !== "object") return "—";
  const c = conditions as Record<string, unknown>;
  const parts: string[] = [];

  const score = c.creditScore as { min?: number; max?: number } | undefined;
  if (score) {
    const range =
      score.min !== undefined && score.max !== undefined
        ? `${score.min}–${score.max}`
        : score.min !== undefined
          ? `≥ ${score.min}`
          : score.max !== undefined
            ? `≤ ${score.max}`
            : "";
    if (range) parts.push(`Score ${range}`);
  }

  const grades = c.creditGrade as string[] | undefined;
  if (grades && grades.length > 0) {
    parts.push(`Grade: ${grades.map((g) => g.replace("_", "+")).join(", ")}`);
  }

  const risk = c.riskLevel as string[] | undefined;
  if (risk && risk.length > 0) parts.push(`Risk: ${risk.join(", ")}`);

  const orders = c.totalOrders as { min?: number; max?: number } | undefined;
  if (orders) {
    const range =
      orders.min !== undefined && orders.max !== undefined
        ? `${orders.min}–${orders.max}`
        : orders.min !== undefined
          ? `≥ ${orders.min}`
          : `≤ ${orders.max}`;
    if (range) parts.push(`Orders ${range}`);
  }

  const revenue = c.totalRevenue as { min?: number; max?: number } | undefined;
  if (revenue) {
    const range =
      revenue.min !== undefined && revenue.max !== undefined
        ? `$${revenue.min.toLocaleString()}–$${(revenue.max ?? 0).toLocaleString()}`
        : revenue.min !== undefined
          ? `≥ $${revenue.min.toLocaleString()}`
          : `≤ $${(revenue.max ?? 0).toLocaleString()}`;
    if (range) parts.push(`Revenue ${range}`);
  }

  const pay = c.onTimePaymentRate as { min?: number; max?: number } | undefined;
  if (pay) {
    const range =
      pay.min !== undefined && pay.max !== undefined
        ? `${Math.round(pay.min * 100)}%–${Math.round((pay.max ?? 0) * 100)}%`
        : pay.min !== undefined
          ? `≥ ${Math.round(pay.min * 100)}%`
          : `≤ ${Math.round((pay.max ?? 0) * 100)}%`;
    if (range) parts.push(`On-Time ${range}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "Any customer";
}

function formatActionValue(
  action: CreditAction,
  value: unknown,
): string {
  if (!value || typeof value !== "object") return "—";
  const v = value as Record<string, unknown>;
  switch (action) {
    case "SET_LIMIT":
    case "ADJUST_LIMIT":
      return v.creditLimit != null ? `$${Number(v.creditLimit).toLocaleString()}` : "—";
    case "SET_GRADE":
      return v.creditGrade != null ? String(v.creditGrade).replace("_", "+") : "—";
    case "SET_TERMS":
      return v.netTerms != null ? `Net ${v.netTerms} days` : "—";
    case "FREEZE":
      return "Freeze account";
    default:
      return String(v);
  }
}

// ─── Page Component ──────────────────────────────────────

export default function RulesPage() {
  const { result } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { items, page, totalPages, total } = result;
  const actionError = fetcher.data?.error;
  const successHandledRef = useRef(false);
  const [visibleSuccess, setVisibleSuccess] = useState(false);

  // Auto-dismiss success banner (Remix auto-revalidates loader after action)
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && !successHandledRef.current) {
      successHandledRef.current = true;
      setVisibleSuccess(true);
      const t = setTimeout(() => setVisibleSuccess(false), 3000);
      return () => clearTimeout(t);
    }
    if (fetcher.state === "submitting") {
      successHandledRef.current = false;
    }
  }, [fetcher.state, fetcher.data?.success]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      const next = new URLSearchParams(searchParams);
      next.set("page", String(newPage));
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  return (
    <Page
      fullWidth
      title="Credit Rules"
      subtitle={`${total} total`}
    >
      <BlockStack gap="400">
        {actionError && <Banner tone="critical">{actionError}</Banner>}
        {visibleSuccess && <Banner tone="success">Action completed successfully.</Banner>}

        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">Credit Rules</Text>
            <Button variant="primary" url="/app/rules/new">Add Rule</Button>
          </InlineStack>
        </Card>

        <Card padding="0">
          {items.length === 0 ? (
            <Box padding="400">
              <EmptyState heading="No credit rules" image="">
                <Text as="p" variant="bodyMd">
                  Create automated credit rules to assign limits, grades, and terms based on customer data.
                </Text>
              </EmptyState>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "rule", plural: "rules" }}
              itemCount={items.length}
              headings={[
                { title: "Rule" },
                { title: "Conditions" },
                { title: "Action" },
                { title: "Priority" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {items.map((rule, index) => (
                <RuleRow key={rule.id} rule={rule} index={index} fetcher={fetcher} />
              ))}
            </IndexTable>
          )}
        </Card>

        {totalPages > 1 && (
          <Box padding="400">
            <BlockStack align="center" inlineAlign="center">
              <Pagination
                label={`Page ${page} of ${totalPages}`}
                hasPrevious={page > 1}
                onPrevious={() => handlePageChange(page - 1)}
                hasNext={page < totalPages}
                onNext={() => handlePageChange(page + 1)}
              />
            </BlockStack>
          </Box>
        )}
      </BlockStack>
    </Page>
  );
}

// ─── Row Component ───────────────────────────────────────

function RuleRow({
  rule,
  index,
  fetcher,
}: {
  rule: {
    id: string;
    name: string;
    description: string | null;
    conditions: unknown;
    action: CreditAction;
    actionValue: unknown;
    priority: number;
    isActive: boolean;
  };
  index: number;
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const actionLabel = ACTION_LABELS[rule.action] ?? rule.action;
  const actionTone = ACTION_TONE[rule.action] ?? "new";
  const conditionsText = formatConditions(rule.conditions);
  const actionValueText = formatActionValue(rule.action, rule.actionValue);
  const isBusy = fetcher.state === "submitting";
  const busyIntent = isBusy ? fetcher.formData?.get("intent")?.toString() : null;
  const isThisRow =
    fetcher.formData && fetcher.formData.get("ruleId") === rule.id;

  // Capture fetcher in a ref to avoid stale closure in stopPropagation handler
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const handleAction = useCallback(
    (e: React.MouseEvent, intent: string, extra?: Record<string, string>) => {
      e.stopPropagation();
      e.preventDefault();
      const fd = new FormData();
      fd.append("intent", intent);
      fd.append("ruleId", rule.id);
      if (extra) {
        Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
      }
      fetcherRef.current.submit(fd, { method: "post" });
    },
    [rule.id],
  );

  return (
    <IndexTable.Row id={rule.id} position={index}>
      <IndexTable.Cell>
          <BlockStack gap="050">
            <Link
              to={`/app/rules/${rule.id}`}
              style={{ fontWeight: 600, textDecoration: "none", color: "inherit" }}
            >
              {rule.name}
            </Link>
            {rule.description && (
              <Text as="span" variant="bodySm" tone="subdued">
                {rule.description}
              </Text>
            )}
          </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {conditionsText}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200" blockAlign="center">
          <Badge tone={actionTone}>{actionLabel}</Badge>
          <Text as="span" variant="bodySm" tone="subdued">
            {actionValueText}
          </Text>
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {rule.priority}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {/* Wrap in div with stopPropagation to bypass IndexTable click interception */}
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
        >
          <Badge tone={rule.isActive ? "success" : "critical"}>
            {rule.isActive ? "Active" : "Inactive"}
          </Badge>
          <button
            type="button"
            onClick={(e) => handleAction(e, "toggle", { isActive: String(!rule.isActive) })}
            disabled={isBusy}
            style={{
              background: "none",
              border: "none",
              cursor: isBusy ? "not-allowed" : "pointer",
              color: "#1B2A4A",
              fontSize: "14px",
              padding: "4px 8px",
              borderRadius: "4px",
              textDecoration: "underline",
              opacity: isBusy ? 0.5 : 1,
            }}
          >
            {rule.isActive ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            onClick={(e) => handleAction(e, "delete")}
            disabled={isBusy}
            style={{
              background: "none",
              border: "none",
              cursor: isBusy ? "not-allowed" : "pointer",
              color: "#D82C0D",
              fontSize: "14px",
              padding: "4px 8px",
              borderRadius: "4px",
              textDecoration: "underline",
              opacity: isBusy ? 0.5 : 1,
            }}
          >
            Delete
          </button>
        </div>
      </IndexTable.Cell>
    </IndexTable.Row>
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
