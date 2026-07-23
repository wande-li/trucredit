// Credit Rules — create / edit page
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  Button,
  Banner,
  FormLayout,
  Checkbox,
  Divider,
  Box,
} from "@shopify/polaris";
import { useState, useCallback, useEffect, useRef } from "react";
import { authenticate } from "~/shopify.server";
import {
  getRule,
  createRule,
  updateRule,
} from "~/services/credit-rule.server";
import type { RuleConditions, RuleActionValue } from "~/services/credit-rule.server";
import prisma from "~/db.server";
import type { CreditAction } from "@prisma/client";
import { logger } from "~/services/logger.server";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";

const ACTION_OPTIONS: Array<{ label: string; value: CreditAction }> = [
  { label: "Set Credit Limit", value: "SET_LIMIT" },
  { label: "Adjust Credit Limit", value: "ADJUST_LIMIT" },
  { label: "Freeze Account", value: "FREEZE" },
  { label: "Set Credit Grade", value: "SET_GRADE" },
  { label: "Set Net Terms", value: "SET_TERMS" },
];

const GRADE_OPTIONS = [
  { label: "A+", value: "A_PLUS" },
  { label: "A", value: "A" },
  { label: "B", value: "B" },
  { label: "C", value: "C" },
  { label: "D", value: "D" },
  { label: "F", value: "F" },
];

// ─── Loader ──────────────────────────────────────────────

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Response("Shop not found", { status: 404 });

    const isNew = params.id === "new";
    if (isNew) {
      return json({ isNew: true, rule: null, shopId: shop.id });
    }

    if (!params.id) throw new Response("Rule ID required", { status: 400 });

    const rule = await getRule({ shopId: shop.id, ruleId: params.id });
    if (!rule) throw new Response("Rule not found", { status: 404 });

    return json({ isNew: false, rule, shopId: shop.id });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Rule detail loader failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

// ─── Action ──────────────────────────────────────────────

export const action = async ({ request, params }: ActionFunctionArgs) => {
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

    if (intent !== "save") {
      return json({ error: "Invalid action" }, { status: 400 });
    }

    const name = formData.get("name")?.toString()?.trim();
    const description = formData.get("description")?.toString()?.trim() || undefined;
    const priorityStr = formData.get("priority")?.toString() ?? "0";
    const isActive = formData.get("isActive") === "true";
    const action = formData.get("action")?.toString() as CreditAction | undefined;

    if (!name) return json({ error: "Name is required" }, { status: 400 });
    if (!action) return json({ error: "Action is required" }, { status: 400 });

    const priority = parseInt(priorityStr, 10);
    if (isNaN(priority)) return json({ error: "Invalid priority" }, { status: 400 });

    // Build conditions from form fields
    const conditions: RuleConditions = {};
    const scoreMin = formData.get("scoreMin")?.toString();
    const scoreMax = formData.get("scoreMax")?.toString();
    if (scoreMin || scoreMax) {
      conditions.creditScore = {};
      if (scoreMin) conditions.creditScore.min = parseInt(scoreMin, 10);
      if (scoreMax) conditions.creditScore.max = parseInt(scoreMax, 10);
    }

    const grades = formData.getAll("grades").map(String).filter(Boolean);
    if (grades.length > 0) conditions.creditGrade = grades;

    const risks = formData.getAll("risks").map(String).filter(Boolean);
    if (risks.length > 0) conditions.riskLevel = risks;

    const orderMin = formData.get("orderMin")?.toString();
    const orderMax = formData.get("orderMax")?.toString();
    if (orderMin || orderMax) {
      conditions.totalOrders = {};
      if (orderMin) conditions.totalOrders.min = parseInt(orderMin, 10);
      if (orderMax) conditions.totalOrders.max = parseInt(orderMax, 10);
    }

    const revMin = formData.get("revenueMin")?.toString();
    const revMax = formData.get("revenueMax")?.toString();
    if (revMin || revMax) {
      conditions.totalRevenue = {};
      if (revMin) conditions.totalRevenue.min = parseFloat(revMin);
      if (revMax) conditions.totalRevenue.max = parseFloat(revMax);
    }

    const payMin = formData.get("payMin")?.toString();
    const payMax = formData.get("payMax")?.toString();
    if (payMin || payMax) {
      conditions.onTimePaymentRate = {};
      if (payMin) conditions.onTimePaymentRate.min = parseInt(payMin, 10) / 100;
      if (payMax) conditions.onTimePaymentRate.max = parseInt(payMax, 10) / 100;
    }

    // Build action value from form fields
    const actionValue: RuleActionValue = {};
    switch (action) {
      case "SET_LIMIT":
      case "ADJUST_LIMIT": {
        const limit = formData.get("actionLimit")?.toString();
        if (!limit) return json({ error: "Credit limit amount is required" }, { status: 400 });
        const num = parseFloat(limit);
        if (isNaN(num) || num <= 0) return json({ error: "Invalid limit amount" }, { status: 400 });
        actionValue.creditLimit = num;
        break;
      }
      case "SET_GRADE": {
        const grade = formData.get("actionGrade")?.toString();
        if (!grade) return json({ error: "Grade is required" }, { status: 400 });
        actionValue.creditGrade = grade;
        break;
      }
      case "SET_TERMS": {
        const terms = formData.get("actionTerms")?.toString();
        if (!terms) return json({ error: "Net terms days is required" }, { status: 400 });
        const num = parseInt(terms, 10);
        if (isNaN(num) || num <= 0) return json({ error: "Invalid net terms" }, { status: 400 });
        actionValue.netTerms = num;
        break;
      }
      case "FREEZE":
        // No value needed for freeze
        break;
    }

    const isNew = params.id === "new";

    if (isNew) {
      await createRule({
        shopId: shop.id,
        name,
        description,
        priority,
        isActive,
        action,
        conditions,
        actionValue,
      });
    } else {
      if (!params.id) throw new Error("Rule ID required");
      // Verify ownership before update
      const existing = await getRule({ shopId: shop.id, ruleId: params.id });
      if (!existing) throw new Response("Rule not found", { status: 404 });

      await updateRule(shop.id, params.id, {
        name,
        description,
        priority,
        isActive,
        action,
        conditions,
        actionValue,
      });
    }

    return json({ success: true });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Rule save failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

// ─── Page Component ──────────────────────────────────────

export default function RuleEditPage() {
  const { isNew, rule } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const navigate = useNavigate();

  // Navigate to list after successful save (ref-guarded against double-fire)
  const navHandledRef = useRef(false);
  useEffect(() => {
    if (fetcher.state === "submitting") {
      navHandledRef.current = false;
      return;
    }
    if (fetcher.state === "idle" && fetcher.data?.success && !navHandledRef.current) {
      navHandledRef.current = true;
      navigate("/app/rules");
    }
  }, [fetcher.state, fetcher.data?.success, navigate]);

  // Form state — initialize from existing rule or defaults
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? 0));
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [action, setAction] = useState<CreditAction>(String(rule?.action ?? "SET_LIMIT") as CreditAction);

  // Conditions state
  const conditions = (rule?.conditions ?? {}) as RuleConditions;
  const [scoreMin, setScoreMin] = useState(String(conditions.creditScore?.min ?? ""));
  const [scoreMax, setScoreMax] = useState(String(conditions.creditScore?.max ?? ""));
  const [selectedGrades, setSelectedGrades] = useState<string[]>(conditions.creditGrade ?? []);
  const [selectedRisks, setSelectedRisks] = useState<string[]>(conditions.riskLevel ?? []);
  const [orderMin, setOrderMin] = useState(String(conditions.totalOrders?.min ?? ""));
  const [orderMax, setOrderMax] = useState(String(conditions.totalOrders?.max ?? ""));
  const [revMin, setRevMin] = useState(String(conditions.totalRevenue?.min ?? ""));
  const [revMax, setRevMax] = useState(String(conditions.totalRevenue?.max ?? ""));
  const [payMin, setPayMin] = useState(
    conditions.onTimePaymentRate?.min != null
      ? String(Math.round(conditions.onTimePaymentRate.min * 100))
      : "",
  );
  const [payMax, setPayMax] = useState(
    conditions.onTimePaymentRate?.max != null
      ? String(Math.round(conditions.onTimePaymentRate.max * 100))
      : "",
  );

  // Action value state
  const av = (rule?.actionValue ?? {}) as RuleActionValue;
  const [actionLimit, setActionLimit] = useState(String(av.creditLimit ?? ""));
  const [actionGrade, setActionGrade] = useState(String(av.creditGrade ?? ""));
  const [actionTerms, setActionTerms] = useState(String(av.netTerms ?? ""));

  const isBusy = fetcher.state === "submitting";
  const error = fetcher.data?.error;
  const isValid = name.trim() !== "";

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "save");
    formData.set("name", name.trim());
    if (description.trim()) formData.set("description", description.trim());
    formData.set("priority", priority);
    formData.set("isActive", String(isActive));
    formData.set("action", action);

    // Conditions
    if (scoreMin) formData.set("scoreMin", scoreMin);
    if (scoreMax) formData.set("scoreMax", scoreMax);
    selectedGrades.forEach((g) => formData.append("grades", g));
    selectedRisks.forEach((r) => formData.append("risks", r));
    if (orderMin) formData.set("orderMin", orderMin);
    if (orderMax) formData.set("orderMax", orderMax);
    if (revMin) formData.set("revenueMin", revMin);
    if (revMax) formData.set("revenueMax", revMax);
    if (payMin) formData.set("payMin", payMin);
    if (payMax) formData.set("payMax", payMax);

    // Action value
    if (actionLimit) formData.set("actionLimit", actionLimit);
    if (actionGrade) formData.set("actionGrade", actionGrade);
    if (actionTerms) formData.set("actionTerms", actionTerms);

    fetcher.submit(formData, { method: "post" });
  }, [
    fetcher, name, description, priority, isActive, action,
    scoreMin, scoreMax, selectedGrades, selectedRisks,
    orderMin, orderMax, revMin, revMax, payMin, payMax,
    actionLimit, actionGrade, actionTerms,
  ]);

  return (
    <Page
      title={isNew ? "Add Credit Rule" : "Edit Credit Rule"}
      backAction={{ url: "/app/rules" }}
    >
      <BlockStack gap="400">
        {error && <Banner tone="critical">{error}</Banner>}

        {/* Rule Info */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Rule Information
            </Text>
            <FormLayout>
              <TextField
                label="Rule Name"
                value={name}
                onChange={setName}
                autoComplete="off"
                placeholder="e.g., High Risk Freeze"
                requiredIndicator
              />
              <TextField
                label="Description"
                value={description}
                onChange={setDescription}
                autoComplete="off"
                placeholder="Optional description of what this rule does"
                multiline={2}
              />
              <TextField
                label="Priority"
                type="number"
                value={priority}
                onChange={(v, _id) => setPriority(v)}
                autoComplete="off"
                helpText="Lower numbers run first. Rules are evaluated in priority order."
                min={0}
                max={999}
              />
              <Checkbox
                label="Active"
                checked={isActive}
                onChange={setIsActive}
                helpText="Inactive rules are not evaluated"
              />
            </FormLayout>
          </BlockStack>
        </Card>

        {/* Conditions */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Conditions
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              All conditions are optional. Leave empty to match all customers. Multiple conditions are combined with AND logic.
            </Text>

            <FormLayout>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Credit Score Range
                </Text>
                <InlineStack gap="200" blockAlign="end">
                  <TextField
                    label="Min Score"
                    type="number"
                    value={scoreMin}
                    onChange={(v, _id) => setScoreMin(v)}
                    autoComplete="off"
                    placeholder="0"
                    min={0}
                    max={100}
                  />
                  <TextField
                    label="Max Score"
                    type="number"
                    value={scoreMax}
                    onChange={(v, _id) => setScoreMax(v)}
                    autoComplete="off"
                    placeholder="100"
                    min={0}
                    max={100}
                  />
                </InlineStack>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Grade
                </Text>
                <InlineStack gap="100" blockAlign="center">
                  {GRADE_OPTIONS.map(({ label, value }) => (
                    <Checkbox
                      key={value}
                      label={label}
                      checked={selectedGrades.includes(value)}
                      onChange={(checked) =>
                        setSelectedGrades((prev) =>
                          checked
                            ? [...prev, value]
                            : prev.filter((g) => g !== value),
                        )
                      }
                    />
                  ))}
                </InlineStack>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Risk Level
                </Text>
                <InlineStack gap="100" blockAlign="center">
                  {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((r) => (
                    <Checkbox
                      key={r}
                      label={r.charAt(0) + r.slice(1).toLowerCase()}
                      checked={selectedRisks.includes(r)}
                      onChange={(checked) =>
                        setSelectedRisks((prev) =>
                          checked ? [...prev, r] : prev.filter((x) => x !== r),
                        )
                      }
                    />
                  ))}
                </InlineStack>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Total Orders Range
                </Text>
                <InlineStack gap="200" blockAlign="end">
                  <TextField
                    label="Min Orders"
                    type="number"
                    value={orderMin}
                    onChange={(v, _id) => setOrderMin(v)}
                    autoComplete="off"
                    placeholder="0"
                    min={0}
                  />
                  <TextField
                    label="Max Orders"
                    type="number"
                    value={orderMax}
                    onChange={(v, _id) => setOrderMax(v)}
                    autoComplete="off"
                    placeholder="No limit"
                    min={0}
                  />
                </InlineStack>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Total Revenue Range (USD)
                </Text>
                <InlineStack gap="200" blockAlign="end">
                  <TextField
                    label="Min Revenue"
                    type="number"
                    value={revMin}
                    onChange={(v, _id) => setRevMin(v)}
                    autoComplete="off"
                    placeholder="0"
                    min={0}
                    step={100}
                  />
                  <TextField
                    label="Max Revenue"
                    type="number"
                    value={revMax}
                    onChange={(v, _id) => setRevMax(v)}
                    autoComplete="off"
                    placeholder="No limit"
                    min={0}
                    step={100}
                  />
                </InlineStack>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  On-Time Payment Rate (%)
                </Text>
                <InlineStack gap="200" blockAlign="end">
                  <TextField
                    label="Min %"
                    type="number"
                    value={payMin}
                    onChange={(v, _id) => setPayMin(v)}
                    autoComplete="off"
                    placeholder="0"
                    min={0}
                    max={100}
                  />
                  <TextField
                    label="Max %"
                    type="number"
                    value={payMax}
                    onChange={(v, _id) => setPayMax(v)}
                    autoComplete="off"
                    placeholder="100"
                    min={0}
                    max={100}
                  />
                </InlineStack>
              </BlockStack>
            </FormLayout>
          </BlockStack>
        </Card>

        {/* Action */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Action
            </Text>
            <FormLayout>
              <Select
                label="When conditions match"
                options={ACTION_OPTIONS}
                value={action}
                onChange={(v, _id) => setAction(v as CreditAction)}
              />

              {(action === "SET_LIMIT" || action === "ADJUST_LIMIT") && (
                <TextField
                  label="Credit Limit Amount (USD)"
                  type="number"
                  value={actionLimit}
                  onChange={setActionLimit}
                  autoComplete="off"
                  placeholder="e.g., 10000"
                  min={0}
                  step={100}
                  requiredIndicator
                />
              )}

              {action === "SET_GRADE" && (
                <Select
                  label="Credit Grade"
                  options={GRADE_OPTIONS}
                  value={actionGrade}
                  onChange={(v, _id) => setActionGrade(v)}
                />
              )}

              {action === "SET_TERMS" && (
                <TextField
                  label="Net Terms (Days)"
                  type="number"
                  value={actionTerms}
                  onChange={setActionTerms}
                  autoComplete="off"
                  placeholder="e.g., 30"
                  min={1}
                  max={365}
                  requiredIndicator
                />
              )}

              {action === "FREEZE" && (
                <Text as="p" variant="bodyMd" tone="subdued">
                  Customer account will be frozen when conditions match.
                </Text>
              )}
            </FormLayout>
          </BlockStack>
        </Card>

        {/* Submit */}
        <Box padding="400">
          <InlineStack gap="200" align="end">
            <Button onClick={() => navigate("/app/rules")} variant="secondary">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!isValid || isBusy}
              loading={isBusy}
              variant="primary"
            >
              {isNew ? "Create Rule" : "Save Changes"}
            </Button>
          </InlineStack>
        </Box>
      </BlockStack>
    </Page>
  );
}

// Route-level ErrorBoundary
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

