// TruCredit — Collection Tasks list
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";

import { useLoaderData, useFetcher, useSearchParams, Link } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  Banner,
  EmptyState,
  InlineStack,
  BlockStack,
  Box,
  Pagination,
  Select,
} from "@shopify/polaris";
import { useCallback, useState } from "react";
import { resolveShop } from "~/services/shop-resolver.server";
import prisma from "~/db.server";
import { pauseTask, stopTask } from "~/services/collection.server";
import { enqueueEmail } from "~/queues/email.queue";
import { PAGINATION } from "~/lib/constants";
import { logger } from "~/services/logger.server";
import { checkPlanAccess } from "~/services/billing.server";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import PageSkeleton from "~/components/PageSkeleton";
import ActionToast from "~/components/ActionToast";

export const meta: MetaFunction = () => [{ title: "TruCredit — Collection Tasks" }];

const STATUS_MAP: Record<string, { label: string; tone: "success" | "attention" | "critical" | "info" | "new" }> = {
  PENDING: { label: "Pending", tone: "new" },
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "Paused", tone: "attention" },
  COMPLETED: { label: "Completed", tone: "info" },
  STOPPED: { label: "Stopped", tone: "critical" },
  ESCALATED: { label: "Escalated", tone: "critical" },
};

const INTENT_MAP: Record<string, { label: string; tone: "success" | "critical" | "attention" | "info" | "new" }> = {
  WILL_PAY: { label: "Will Pay", tone: "success" },
  ALREADY_PAID: { label: "Already Paid", tone: "success" },
  DISPUTE: { label: "Dispute", tone: "critical" },
  PAYMENT_PLAN: { label: "Payment Plan", tone: "attention" },
  DELAY_REQUEST: { label: "Delay Request", tone: "attention" },
  CANNOT_PAY: { label: "Cannot Pay", tone: "critical" },
  UNRELATED: { label: "Unrelated", tone: "info" },
};

function daysToStage(daysOverdue: number): string {
  if (daysOverdue < 0) return "STAGE_MINUS_7";
  if (daysOverdue === 0) return "STAGE_PLUS_0";
  if (daysOverdue <= 7) return "STAGE_PLUS_7";
  if (daysOverdue <= 14) return "STAGE_PLUS_14";
  if (daysOverdue <= 30) return "STAGE_PLUS_30";
  if (daysOverdue <= 60) return "STAGE_PLUS_60";
  return "STAGE_PLUS_90";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:app.tasks START");
  try {
    const { shopId } = await resolveShop(request);

    const { isPaid } = await checkPlanAccess(shopId);
    if (!isPaid) return redirect("/app/billing");

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
    const pageSize = Math.min(
      parseInt(url.searchParams.get("pageSize") ?? String(PAGINATION.DEFAULT_PAGE_SIZE), 10),
      PAGINATION.MAX_PAGE_SIZE,
    );
    const statusFilter = url.searchParams.get("status") ?? "";

    const where: Record<string, unknown> = {
      sequence: { shopId },
    };
    if (statusFilter && statusFilter !== "ALL") {
      where.status = statusFilter;
    }

    const [tasks, total, sequenceCount] = await Promise.all([
      prisma.collectionTask.findMany({
        where,
        include: {
          sequence: { select: { name: true } },
          customer: { select: { id: true, name: true, company: true, email: true } },
          invoice: { select: { id: true, invoiceNumber: true, amount: true, currency: true, dueDate: true, status: true } },
          events: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: [{ status: "asc" }, { nextStepAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.collectionTask.count({ where }),
      prisma.collectionSequence.count({ where: { shopId } }),
    ]);

    // Summary counts
    const [activeCount, pausedCount, escalatedCount] = await Promise.all([
      prisma.collectionTask.count({ where: { ...where, status: "ACTIVE" } }),
      prisma.collectionTask.count({ where: { ...where, status: "PAUSED" } }),
      prisma.collectionTask.count({ where: { ...where, status: "ESCALATED" } }),
    ]);

    logger.app("INFO", "loader:app.tasks OK", null, {
      durationMs: Date.now() - t0,
      totalCount: tasks.length,
      total,
      active: activeCount,
      paused: pausedCount,
      escalated: escalatedCount,
    });
    return json({
      tasks,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      summary: { active: activeCount, paused: pausedCount, escalated: escalatedCount },
      statusFilter,
      hasSequences: sequenceCount > 0,
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:app.tasks ERROR", msg, { durationMs: Date.now() - t0 });
    throw new Response("Something went wrong", { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ta = Date.now();
  logger.app("INFO", "action:app.tasks START");
  try {
    const { shopId } = await resolveShop(request);

    const { isPaid } = await checkPlanAccess(shopId);
    if (!isPaid) {
      logger.app("WARN", "action:app.tasks plan_gate blocked", null, { shopId });
      return json({ error: "Task management requires a paid plan. Please upgrade." }, { status: 402 });
    }

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();
    const taskId = formData.get("taskId")?.toString();
    if (!taskId) return json({ error: "A task is required." }, { status: 400 });

    switch (intent) {
      case "pause": {
        await pauseTask({ taskId, shopId, reason: "Manually paused" });
        logger.app("INFO", "action:app.tasks pause OK", null, { durationMs: Date.now() - ta, taskId });
        return json({ success: true });
      }
      case "stop": {
        await stopTask({ taskId, shopId, reason: "Manually stopped" });
        logger.app("INFO", "action:app.tasks stop OK", null, { durationMs: Date.now() - ta, taskId });
        return json({ success: true });
      }
      case "resume": {
        // Verify task belongs to this shop
        const task = await prisma.collectionTask.findUnique({
          where: { id: taskId, sequence: { shopId } },
        });
        if (!task || task.status !== "PAUSED") {
          return json({ error: "This task cannot be resumed right now. It may already be active." }, { status: 400 });
        }
        await prisma.collectionTask.update({
          where: { id: taskId, sequence: { shopId } },
          data: { status: "ACTIVE" },
        });
        logger.app("INFO", "action:app.tasks resume OK", null, { durationMs: Date.now() - ta, taskId });
        return json({ success: true });
      }
      case "send": {
        // Verify task belongs to this shop
        const task = await prisma.collectionTask.findUnique({
          where: { id: taskId, sequence: { shopId } },
          include: {
            customer: { select: { name: true, company: true, email: true } },
            invoice: { select: { invoiceNumber: true, amount: true, currency: true, dueDate: true, paymentUrl: true, shopifyOrderName: true } },
            sequence: { select: { steps: { orderBy: { order: "asc" }, take: 1 } } },
          },
        });
        if (!task || !task.customer || !task.invoice) {
          return json({ error: "Required data is missing. Please refresh the page." }, { status: 400 });
        }

        const daysOverdue = Math.floor(
          (Date.now() - task.invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        await enqueueEmail({
          shopId,
          toEmail: task.customer.email,
          stage: daysToStage(daysOverdue),
          useAI: task.sequence.steps[0]?.useAI ?? false,
          toneLevel: task.sequence.steps[0]?.toneLevel ?? 3,
          vars: {
            customerName: task.customer.name,
            companyName: task.customer.company ?? undefined,
            invoiceNumber: task.invoice.invoiceNumber,
            amount: String(task.invoice.amount),
            currency: task.invoice.currency,
            dueDate: task.invoice.dueDate.toISOString().slice(0, 10),
            daysOverdue,
            paymentLink: task.invoice.paymentUrl ?? undefined,
          },
          taskId,
          stepOrder: task.currentStep,
        });

        logger.app("INFO", "action:app.tasks send OK", null, { durationMs: Date.now() - ta, taskId });
        return json({ success: true });
      }
      default:
        logger.app("WARN", "action:app.tasks unknown_intent", null, { intent });
        return json({ error: "Something went wrong. Please try again." }, { status: 400 });
    }
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "action:app.tasks ERROR", msg, { durationMs: Date.now() - ta });
    throw new Response("Something went wrong", { status: 500 });
  }
};

export default function TasksPage() {
  const { tasks, page, totalPages, summary, statusFilter, hasSequences } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [, setSearchParams] = useSearchParams();
  const [stopConfirmId, setStopConfirmId] = useState<string | null>(null);

  const actionData = fetcher.data;

  const handlePause = useCallback(
    (taskId: string) => {
      fetcher.submit({ intent: "pause", taskId }, { method: "POST" });
    },
    [fetcher],
  );

  const handleResume = useCallback(
    (taskId: string) => {
      fetcher.submit({ intent: "resume", taskId }, { method: "POST" });
    },
    [fetcher],
  );

  const handleStop = useCallback(
    (taskId: string) => {
      fetcher.submit({ intent: "stop", taskId }, { method: "POST" });
      setStopConfirmId(null);
    },
    [fetcher],
  );

  const handleSend = useCallback(
    (taskId: string) => {
      fetcher.submit({ intent: "send", taskId }, { method: "POST" });
    },
    [fetcher],
  );

  const handleStatusFilter = useCallback(
    (value: string) => {
      setSearchParams((sp) => {
        if (value && value !== "ALL") sp.set("status", value);
        else sp.delete("status");
        sp.delete("page");
        return sp;
      });
    },
    [setSearchParams],
  );

  const prevPage = () => {
    setSearchParams((sp) => {
      sp.set("page", String(Math.max(1, page - 1)));
      return sp;
    });
  };

  const nextPage = () => {
    setSearchParams((sp) => {
      sp.set("page", String(Math.min(totalPages, page + 1)));
      return sp;
    });
  };

  const statusOptions = [
    { label: "All", value: "ALL" },
    { label: "Active", value: "ACTIVE" },
    { label: "Paused", value: "PAUSED" },
    { label: "Escalated", value: "ESCALATED" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Stopped", value: "STOPPED" },
  ];

  const actionError = actionData?.error;
  const [errorDismissed, setErrorDismissed] = useState(false);

  return (
    <Page
      fullWidth
      title="Collection Tasks"
      subtitle={`${summary.active} active, ${summary.paused} paused, ${summary.escalated} escalated`}
    >
      <ActionToast fetcher={fetcher} successMessage="Task updated successfully" />
      <BlockStack gap="400">
        {actionError && !errorDismissed && (
          <Banner tone="critical" onDismiss={() => setErrorDismissed(true)}>
            {actionError}
          </Banner>
        )}

        <Box>
          <Select
            label="Status"
            labelInline
            options={statusOptions}
            value={statusFilter || "ALL"}
            onChange={handleStatusFilter}
          />
        </Box>

        {tasks.length === 0 ? (
          <Card>
            {hasSequences ? (
              <EmptyState
                heading="No collection tasks yet"
                image=""
                action={{ content: "View Sequences", url: "/app/collections" }}
              >
                <p>
                  Tasks are automatically created when invoices become overdue and match an active collection sequence.
                  Make sure your sequences are active and you have overdue invoices.
                </p>
              </EmptyState>
            ) : (
              <EmptyState
                heading="No collection tasks"
                image=""
                action={{ content: "Set Up Sequences", url: "/app/collections" }}
              >
                <p>Active collection sequences will automatically create tasks for overdue invoices.</p>
              </EmptyState>
            )}
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "task", plural: "tasks" }}
              itemCount={tasks.length}
              selectable={false}
              headings={[
                { title: "Invoice" },
                { title: "Customer" },
                { title: "Sequence" },
                { title: "Step" },
                { title: "Status" },
                { title: "Reply" },
                { title: "Next Action" },
                { title: "Controls" },
              ]}
            >
              {tasks.map((task, idx) => {
                const st = STATUS_MAP[task.status] ?? { label: task.status, tone: "info" as const };
                const replyIntent = (task as Record<string, unknown>).lastReplyIntent as string | undefined;
                const ri = replyIntent ? INTENT_MAP[replyIntent] ?? null : null;

                return (
                  <IndexTable.Row key={task.id} id={task.id} position={idx}>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        <Link
                          to={`/app/invoices/${task.invoice.id}`}
                          style={{ fontWeight: 500, textDecoration: "none", color: "inherit" }}
                        >
                          {task.invoice.invoiceNumber}
                        </Link>
                        <Text as="span" tone="subdued">
                          {Number(task.invoice.amount).toLocaleString()} {task.invoice.currency}
                        </Text>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Link
                        to={`/app/customers/${task.customer.id}`}
                        style={{ textDecoration: "none", color: "var(--p-interactive)" }}
                      >
                        {task.customer.name}
                      </Link>
                      {task.customer.company && (
                        <Text as="p" tone="subdued" variant="bodySm">
                          {task.customer.company}
                        </Text>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span">{task.sequence.name}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span">
                        Step {task.currentStep}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {ri ? (
                        <Badge tone={ri.tone}>{ri.label}</Badge>
                      ) : (
                        <Text as="span" tone="subdued">
                          —
                        </Text>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {task.nextStepAt ? (
                        <Text as="span" tone="subdued">
                          {new Date(task.nextStepAt).toLocaleDateString('en-US')}
                        </Text>
                      ) : (
                        <Text as="span" tone="subdued">
                          —
                        </Text>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {task.status === "ACTIVE" && (
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => handleSend(task.id)}>
                            Send
                          </Button>
                          <Button size="slim" onClick={() => handlePause(task.id)}>
                            Pause
                          </Button>
                          <Button size="slim" tone="critical" onClick={() => setStopConfirmId(task.id)}>
                            Stop
                          </Button>
                        </InlineStack>
                      )}
                      {task.status === "PAUSED" && (
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => handleSend(task.id)}>
                            Send
                          </Button>
                          <Button size="slim" tone="success" onClick={() => handleResume(task.id)}>
                            Resume
                          </Button>
                          <Button size="slim" tone="critical" onClick={() => setStopConfirmId(task.id)}>
                            Stop
                          </Button>
                        </InlineStack>
                      )}
                      {task.status === "ESCALATED" && (
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => handleSend(task.id)}>
                            Send
                          </Button>
                          <Button size="slim" onClick={() => handlePause(task.id)}>
                            Pause
                          </Button>
                        </InlineStack>
                      )}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>

            {totalPages > 1 && (
              <Box padding="400">
                <BlockStack align="center" inlineAlign="center">
                  <Pagination
                    label={`Page ${page} of ${totalPages}`}
                    hasPrevious={page > 1}
                    onPrevious={prevPage}
                    hasNext={page < totalPages}
                    onNext={nextPage}
                  />
                </BlockStack>
              </Box>
            )}
          </Card>
        )}

        {/* Stop confirm banner */}
        {stopConfirmId && (
          <Banner
            tone="critical"
            title="Stop this collection task?"
            action={{
              content: "Yes, Stop",
              onAction: () => handleStop(stopConfirmId),
            }}
          >
            <p>
              The customer will no longer receive automated reminders for this invoice.
              This cannot be undone.
            </p>
            <Box paddingBlockStart="200">
              <Button onClick={() => setStopConfirmId(null)}>Cancel</Button>
            </Box>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}

// Route-level loading skeleton
export function HydrateFallback() {
  return <PageSkeleton />;
}

// Route-level ErrorBoundary
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

