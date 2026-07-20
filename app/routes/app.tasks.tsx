// TruCredit — Collection Tasks list
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate, useSearchParams } from "@remix-run/react";
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
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { pauseTask, stopTask } from "~/services/collection.server";
import { enqueueEmail } from "~/queues/email.queue";
import { PAGINATION } from "~/lib/constants";

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
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Response("Shop not found", { status: 404 });

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
    const pageSize = Math.min(
      parseInt(url.searchParams.get("pageSize") ?? String(PAGINATION.DEFAULT_PAGE_SIZE), 10),
      PAGINATION.MAX_PAGE_SIZE,
    );
    const statusFilter = url.searchParams.get("status") ?? "";

    const where: Record<string, unknown> = {
      sequence: { shopId: shop.id },
    };
    if (statusFilter && statusFilter !== "ALL") {
      where.status = statusFilter;
    }

    const [tasks, total] = await Promise.all([
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
    ]);

    // Summary counts
    const [activeCount, pausedCount, escalatedCount] = await Promise.all([
      prisma.collectionTask.count({ where: { ...where, status: "ACTIVE" } }),
      prisma.collectionTask.count({ where: { ...where, status: "PAUSED" } }),
      prisma.collectionTask.count({ where: { ...where, status: "ESCALATED" } }),
    ]);

    return json({
      tasks,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      summary: { active: activeCount, paused: pausedCount, escalated: escalatedCount },
      statusFilter,
    });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new Response(`Failed to load data: ${msg}`, { status: 500 });
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
    if (!shop) return json({ error: "Shop not found" }, { status: 404 });

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();
    const taskId = formData.get("taskId")?.toString();
    if (!taskId) return json({ error: "Task ID required" }, { status: 400 });

    switch (intent) {
      case "pause": {
        await pauseTask({ taskId, reason: "Manually paused" });
        return json({ success: true });
      }
      case "stop": {
        await stopTask({ taskId, reason: "Manually stopped" });
        return json({ success: true });
      }
      case "resume": {
        const task = await prisma.collectionTask.findUnique({ where: { id: taskId } });
        if (!task || task.status !== "PAUSED") {
          return json({ error: "Task not found or not paused" }, { status: 400 });
        }
        await prisma.collectionTask.update({
          where: { id: taskId },
          data: { status: "ACTIVE" },
        });
        return json({ success: true });
      }
      case "send": {
        const task = await prisma.collectionTask.findUnique({
          where: { id: taskId },
          include: {
            customer: { select: { name: true, company: true, email: true } },
            invoice: { select: { invoiceNumber: true, amount: true, currency: true, dueDate: true, paymentUrl: true, shopifyOrderName: true } },
            sequence: { select: { steps: { orderBy: { order: "asc" }, take: 1 } } },
          },
        });
        if (!task || !task.customer || !task.invoice) {
          return json({ error: "Task, customer, or invoice not found" }, { status: 400 });
        }

        const daysOverdue = Math.floor(
          (Date.now() - task.invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        await enqueueEmail({
          shopId: shop.id,
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

        return json({ success: true });
      }
      default:
        return json({ error: "Unknown intent" }, { status: 400 });
    }
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new Response(`Task action failed: ${msg}`, { status: 500 });
  }
};

export default function TasksPage() {
  const { tasks, page, totalPages, summary, statusFilter } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [stopConfirmId, setStopConfirmId] = useState<string | null>(null);

  const actionData = fetcher.data;
  const isSubmitting = fetcher.state === "submitting";

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
            <EmptyState
              heading="No collection tasks"
              image=""
              action={{ content: "Set Up Sequences", url: "/app/collections" }}
            >
              <p>Active collection sequences will automatically create tasks for overdue invoices.</p>
            </EmptyState>
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
                        <Button
                          variant="plain"
                          onClick={() => navigate(`/app/invoices/${task.invoice.id}`)}
                        >
                          {task.invoice.invoiceNumber}
                        </Button>
                        <Text as="span" tone="subdued">
                          {Number(task.invoice.amount).toLocaleString()} {task.invoice.currency}
                        </Text>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Button
                        variant="plain"
                        onClick={() => navigate(`/app/customers/${task.customer.id}`)}
                      >
                        {task.customer.name}
                      </Button>
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
                          {new Date(task.nextStepAt).toLocaleDateString()}
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
