// TruCredit — Reply Inbox (AI-parsed customer replies)
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import {
  Page,
  BlockStack,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  ButtonGroup,
  Banner,
  EmptyState,
  Box,
  InlineStack,
  Select,
  Modal,
  FormLayout,
  Divider,
  Pagination,
} from "@shopify/polaris";
import { useState, useCallback, useMemo } from "react";
import { authenticate } from "~/shopify.server";
import { listReplies, resolveReply } from "~/services/reply.server";
import type { ReplyIntent } from "@prisma/client";
import prisma from "~/db.server";

const REPLY_INTENT_LABELS: Record<string, string> = {
  WILL_PAY: "Will Pay",
  ALREADY_PAID: "Already Paid",
  DISPUTE: "Dispute",
  PAYMENT_PLAN: "Payment Plan",
  DELAY_REQUEST: "Delay Request",
  CANNOT_PAY: "Cannot Pay",
  UNRELATED: "Unrelated",
};

const REPLY_INTENT_COLORS: Record<string, "success" | "attention" | "critical" | "info" | "new" | "warning"> = {
  WILL_PAY: "success",
  ALREADY_PAID: "success",
  DISPUTE: "critical",
  PAYMENT_PLAN: "attention",
  DELAY_REQUEST: "attention",
  CANNOT_PAY: "critical",
  UNRELATED: "info",
};

const CONFIDENCE_COLORS: Record<string, "success" | "attention" | "critical"> = {
  high: "success",
  medium: "attention",
  low: "critical",
};

function confidenceLevel(c: number): "high" | "medium" | "low" {
  if (c >= 0.85) return "high";
  if (c >= 0.6) return "medium";
  return "low";
}

function shortBody(body: string | null | undefined, maxLen = 120): string {
  if (!body) return "(empty)";
  return body.length > maxLen ? body.slice(0, maxLen) + "…" : body;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop.trim();

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const intent = (url.searchParams.get("intent") ?? undefined) as ReplyIntent | undefined;

  const result = await listReplies(shop.id, { page, intent });

  return json({ shopId: shop.id, ...result });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop.trim();

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "resolve") {
    const eventId = formData.get("eventId")?.toString();
    const taskId = formData.get("taskId")?.toString();
    const notes = formData.get("notes")?.toString()?.trim();

    if (!eventId || !taskId) return json({ error: "Missing parameters" }, { status: 400 });

    const result = await resolveReply({ eventId, taskId, shopId: shop.id, notes });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function RepliesPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { items, page, total, totalPages } = loaderData;
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedIntent, setSelectedIntent] = useState(searchParams.get("intent") ?? "ALL");
  const [detailEvent, setDetailEvent] = useState<typeof items[0] | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const actionData = fetcher.data as { success?: boolean; error?: string } | undefined;

  // Deduplicate: show only REPLY_RECEIVED events (skip INTENT_DETECTED duplicates)
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((e) => {
      if (e.type === "REPLY_RECEIVED") {
        seen.add(e.taskId + "::" + e.replyIntent);
        return true;
      }
      // INTENT_DETECTED: only if no REPLY_RECEIVED for same task+intent
      const key = e.taskId + "::" + e.replyIntent;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [items]);

  const handleIntentFilter = useCallback(
    (value: string) => {
      setSelectedIntent(value);
      if (value === "ALL") {
        searchParams.delete("intent");
      } else {
        searchParams.set("intent", value);
      }
      searchParams.delete("page");
      setSearchParams(searchParams);
    },
    [searchParams, setSearchParams],
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      const next = new URLSearchParams(searchParams);
      next.set("page", String(newPage));
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const intentOptions = [
    { label: "All Intents", value: "ALL" },
    ...Object.entries(REPLY_INTENT_LABELS).map(([k, v]) => ({ label: v, value: k })),
  ];

  return (
    <Page
      fullWidth
      title="Reply Inbox"
      subtitle="Customer email replies — AI-classified for fast triage"
    >
      <BlockStack gap="400">
        {actionData?.error && !bannerDismissed && (
          <Banner tone="critical" onDismiss={() => setBannerDismissed(true)}>
            {actionData.error}
          </Banner>
        )}

        {/* Filters */}
        <Card>
          <Box padding="400">
            <InlineStack gap="400" align="space-between" blockAlign="center">
              <Select
                label="Intent"
                labelInline
                options={intentOptions}
                value={selectedIntent}
                onChange={handleIntentFilter}
              />
              <Text as="span" tone="subdued">
                {total} reply{total !== 1 ? "ies" : ""}
              </Text>
            </InlineStack>
          </Box>
        </Card>

        {deduped.length === 0 ? (
          <Card>
            <EmptyState
              heading="No replies yet"
              image=""
            >
              <p>Customer email replies will appear here once collection emails are sent and customers respond.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "reply", plural: "replies" }}
              itemCount={deduped.length}
              selectable={false}
              headings={[
                { title: "Invoice" },
                { title: "Customer" },
                { title: "Subject" },
                { title: "Intent" },
                { title: "Confidence" },
                { title: "Received" },
                { title: "Actions" },
              ]}
            >
              {deduped.map((evt, idx) => {
                const inv = evt.task?.invoice;
                return (
                  <IndexTable.Row key={evt.id} id={evt.id} position={idx}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="bold">
                        {inv?.invoiceNumber ?? "N/A"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">—</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" truncate>
                        {evt.emailSubject || shortBody(evt.emailBody, 60)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={REPLY_INTENT_COLORS[evt.replyIntent ?? "UNRELATED"] ?? "info"}>
                        {REPLY_INTENT_LABELS[evt.replyIntent ?? "UNRELATED"] ?? evt.replyIntent}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={CONFIDENCE_COLORS[confidenceLevel(evt.replyConfidence ?? 0)]}>
                        {evt.replyConfidence != null ? `${Math.round(evt.replyConfidence * 100)}%` : "—"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {new Date(evt.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <ButtonGroup>
                        <Button size="slim" onClick={() => setDetailEvent(evt)}>View</Button>
                        <Button
                          size="slim"
                          tone="success"
                          onClick={() => {
                            fetcher.submit(
                              { intent: "resolve", eventId: evt.id, taskId: evt.taskId },
                              { method: "POST" },
                            );
                          }}
                        >
                          Resolve
                        </Button>
                      </ButtonGroup>
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
                    onPrevious={() => handlePageChange(page - 1)}
                    hasNext={page < totalPages}
                    onNext={() => handlePageChange(page + 1)}
                  />
                </BlockStack>
              </Box>
            )}
          </Card>
        )}
      </BlockStack>

      {/* Detail Modal */}
      {detailEvent && (
        <ReplyDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onResolve={(eid, tid) => {
            fetcher.submit({ intent: "resolve", eventId: eid, taskId: tid }, { method: "POST" });
            setDetailEvent(null);
          }}
        />
      )}
    </Page>
  );
}

function ReplyDetailModal({
  event,
  onClose,
  onResolve,
}: {
  event: {
    id: string;
    taskId: string;
    emailSubject: string | null;
    emailBody: string | null;
    replyIntent: ReplyIntent | null;
    replyConfidence: number | null;
    aiAnalysis: unknown;
    createdAt: string;
    task: { invoice: { invoiceNumber: string; amount: string; currency: string } | null } | null;
  };
  onClose: () => void;
  onResolve: (eventId: string, taskId: string) => void;
}) {
  const analysis: Record<string, unknown> = (event.aiAnalysis as Record<string, unknown>) ?? {};
  const inv = event.task?.invoice;

  return (
    <Modal
      open
      onClose={onClose}
      title="Reply Detail"
      primaryAction={{
        content: "Mark Resolved",
        onAction: () => onResolve(event.id, event.taskId),
      }}
      secondaryActions={[{ content: "Close", onAction: onClose }]}
      size="large"
    >
      <Modal.Section>
        <FormLayout>
          {inv && (
            <InlineStack gap="400">
              <Box>
                <Text as="span" tone="subdued">Invoice</Text>
                <Text as="p" fontWeight="bold">{inv.invoiceNumber}</Text>
              </Box>
              <Box>
                <Text as="span" tone="subdued">Amount</Text>
                <Text as="p" fontWeight="bold">{inv.amount} {inv.currency}</Text>
              </Box>
            </InlineStack>
          )}

          <Divider />

          <Box>
            <Text as="span" tone="subdued">Subject</Text>
            <Text as="p">{event.emailSubject || "(no subject)"}</Text>
          </Box>

          <Box>
            <Text as="span" tone="subdued">Body</Text>
            <Box padding="400" background="bg-surface-secondary" borderRadius="200">
              <Text as="p">{event.emailBody || "(empty)"}</Text>
            </Box>
          </Box>

          <Divider />

          <InlineStack gap="400">
            <Box>
              <Text as="span" tone="subdued">AI Intent</Text>
              <Box paddingBlockStart="100">
                <Badge tone={REPLY_INTENT_COLORS[event.replyIntent ?? "UNRELATED"] ?? "info"}>
                  {REPLY_INTENT_LABELS[event.replyIntent ?? "UNRELATED"]}
                </Badge>
              </Box>
            </Box>
            <Box>
              <Text as="span" tone="subdued">Confidence</Text>
              <Box paddingBlockStart="100">
                <Badge tone={CONFIDENCE_COLORS[confidenceLevel(event.replyConfidence ?? 0)]}>
                  {event.replyConfidence != null ? `${Math.round(event.replyConfidence * 100)}%` : "—"}
                </Badge>
              </Box>
            </Box>
          </InlineStack>

          {Boolean(analysis.summary) && (
            <Box>
              <Text as="span" tone="subdued">AI Summary</Text>
              <Text as="p">{String(analysis.summary)}</Text>
            </Box>
          )}

          {Boolean(analysis.suggestedAction) && (
            <Box>
              <Text as="span" tone="subdued">Suggested Action</Text>
              <Text as="p" fontWeight="semibold">{String(analysis.suggestedAction)}</Text>
            </Box>
          )}

          {Boolean(analysis.autoResponse) && (
            <Box>
              <Text as="span" tone="subdued">Auto-Response Draft</Text>
              <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                <Text as="p">{String(analysis.autoResponse)}</Text>
              </Box>
            </Box>
          )}
        </FormLayout>
      </Modal.Section>
    </Modal>
  );
}
