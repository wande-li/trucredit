import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  IndexTable,
  Badge,
  Pagination,
  TextField,
  Select,
  Tabs,
  Box,
  Button,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { listInvoices, getARAgingReport } from "~/services/invoice.server";
import prisma from "~/db.server";
import { useCallback, useMemo } from "react";
import { logger } from "~/services/logger.server";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import PageSkeleton from "~/components/PageSkeleton";

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
    const search = url.searchParams.get("search") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);

    const [invoiceResult, agingReport] = await Promise.all([
      listInvoices({ shopId: shop.id, search, status, page }),
      getARAgingReport(shop.id),
    ]);

    return json({ invoiceResult, agingReport, shopDomain });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Invoices loader failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

const statusTone: Record<string, "success" | "critical" | "attention" | "warning" | "new" | "info"> = {
  PAID: "success",
  OVERDUE: "critical",
  DISPUTED: "attention",
  PARTIALLY_PAID: "warning",
  DRAFT: "new",
  PENDING: "info",
  VOID: "info",
};

const statusLabel: Record<string, string> = {
  PAID: "Paid",
  OVERDUE: "Overdue",
  DISPUTED: "Disputed",
  PARTIALLY_PAID: "Partial",
  DRAFT: "Draft",
  PENDING: "Pending",
  VOID: "Void",
};

export default function Invoices() {
  const { invoiceResult, agingReport } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("agingBucket") ?? "all";
  const currentStatus = searchParams.get("status") ?? "";

  const navigate = useNavigate();

  const handleTabChange = useCallback(
    (selected: number) => {
      const buckets = ["all", "current", "1-30", "31-60", "61-90", "90+"];
      const bucket = buckets[selected] ?? "all";
      if (bucket === "all") {
        searchParams.delete("agingBucket");
      } else {
        searchParams.set("agingBucket", bucket);
      }
      searchParams.delete("page");
      setSearchParams(searchParams);
    },
    [searchParams, setSearchParams],
  );

  const selectedTabIndex = useMemo(() => {
    const buckets = ["all", "current", "1-30", "31-60", "61-90", "90+"];
    return Math.max(0, buckets.indexOf(currentTab));
  }, [currentTab]);

  return (
    <Page
      fullWidth
      title="Invoices"
      subtitle={`${agingReport.totalInvoices} outstanding · ${agingReport.totalCustomers} customers · DSO: ${
        agingReport.dso ?? "—"
      } days`}
      primaryAction={
        <Button variant="primary" onClick={() => navigate("/app/invoices/new")}>Create Invoice</Button>
      }
    >
      <BlockStack gap="400">
        {/* AR Aging Summary Cards */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              AR Aging Summary
            </Text>
            <InlineStack gap="500" wrap>
              {agingReport.buckets.map((bucket) => (
                <Box key={bucket.label} minWidth="150px" padding="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {bucket.label}
                    </Text>
                    <Text
                      as="p"
                      variant="headingLg"
                      fontWeight="bold"
                      tone={
                        bucket.label === "90+ Days"
                          ? "critical"
                          : undefined
                      }
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
            <InlineStack gap="400" align="start">
              <Text as="p" variant="bodyMd" fontWeight="bold">
                Total Outstanding: ${Number(agingReport.totalOutstanding).toLocaleString()}
              </Text>
              <Text as="p" variant="bodyMd" tone="critical">
                Total Overdue: ${Number(agingReport.totalOverdue).toLocaleString()}
              </Text>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Filters */}
        <Card>
          <BlockStack gap="400">
            {/* Aging Bucket Tabs */}
            <Tabs
              tabs={[
                { id: "all", content: "All" },
                { id: "current", content: "Current" },
                { id: "1-30", content: "1-30 Days" },
                { id: "31-60", content: "31-60 Days" },
                { id: "61-90", content: "61-90 Days" },
                { id: "90+", content: "90+ Days" },
              ]}
              selected={selectedTabIndex}
              onSelect={handleTabChange}
            />

            <InlineStack gap="300" align="start" blockAlign="center">
              <Box minWidth="240px">
                <TextField
                  label="Search"
                  labelHidden
                  placeholder="Search by invoice # or order name..."
                  value={searchParams.get("search") ?? ""}
                  onChange={(v) => {
                    if (v) searchParams.set("search", v);
                    else searchParams.delete("search");
                    searchParams.delete("page");
                    setSearchParams(searchParams);
                  }}
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => {
                    searchParams.delete("search");
                    searchParams.delete("page");
                    setSearchParams(searchParams);
                  }}
                />
              </Box>

              <Box minWidth="160px">
                <Select
                  label="Status"
                  labelHidden
                  placeholder="All Statuses"
                  value={currentStatus}
                  onChange={(v) => {
                    if (v) searchParams.set("status", v);
                    else searchParams.delete("status");
                    searchParams.delete("page");
                    setSearchParams(searchParams);
                  }}
                  options={[
                    { label: "All Statuses", value: "" },
                    { label: "Pending", value: "PENDING" },
                    { label: "Overdue", value: "OVERDUE" },
                    { label: "Partially Paid", value: "PARTIALLY_PAID" },
                    { label: "Paid", value: "PAID" },
                    { label: "Disputed", value: "DISPUTED" },
                    { label: "Void", value: "VOID" },
                  ]}
                />
              </Box>

              {(searchParams.get("search") || searchParams.get("status")) && (
                <Button
                  onClick={() => setSearchParams(new URLSearchParams())}
                  variant="plain"
                >
                  Clear filters
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Invoice Table */}
        {invoiceResult.items.length === 0 ? (
          <Card>
            <EmptyState
              heading="No invoices found"
              image=""
            >
              <Text as="p" variant="bodyMd" tone="subdued">
                {searchParams.toString()
                  ? "Try adjusting your filters."
                  : "Invoices will appear here when customers place orders on net terms."}
              </Text>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "invoice", plural: "invoices" }}
              itemCount={invoiceResult.items.length}
              headings={[
                { title: "Invoice #" },
                { title: "Customer" },
                { title: "Amount" },
                { title: "Issue Date" },
                { title: "Due Date" },
                { title: "Overdue" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {invoiceResult.items.map((inv, idx) => (
                <IndexTable.Row key={inv.id} id={inv.id} position={idx}>
                  <IndexTable.Cell>
                      <div
                        onMouseDown={(e) => { e.stopPropagation(); const u = new URL(window.location.href); u.pathname = `/app/invoices/${inv.id}`; window.location.href = u.toString(); }}
                        style={{ cursor: "pointer", fontWeight: 600, userSelect: "none" }}
                      >
                        {inv.invoiceNumber}
                      </div>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd">
                        {inv.customerName}
                      </Text>
                      {inv.customerCompany && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {inv.customerCompany}
                        </Text>
                      )}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" fontWeight="bold">
                      {inv.currency} {Number(inv.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">
                      {new Date(inv.issueDate).toLocaleDateString()}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">
                      {new Date(inv.dueDate).toLocaleDateString()}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {inv.daysOverdue > 0 ? (
                      <Text as="span" variant="bodyMd" tone="critical" fontWeight="bold">
                        {inv.daysOverdue}d
                      </Text>
                    ) : (
                      <Text as="span" variant="bodyMd" tone="subdued">
                        —
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={statusTone[inv.status] ?? "info"}>
                      {statusLabel[inv.status] ?? inv.status}
                    </Badge>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}

        {/* Pagination */}
        {invoiceResult.totalPages > 1 && (
          <Box paddingBlockStart="400">
            <InlineStack align="center">
              <Pagination
                label={`Page ${invoiceResult.page} of ${invoiceResult.totalPages}`}
                hasPrevious={invoiceResult.page > 1}
                onPrevious={() => {
                  searchParams.set("page", String(invoiceResult.page - 1));
                  setSearchParams(searchParams);
                }}
                hasNext={invoiceResult.page < invoiceResult.totalPages}
                onNext={() => {
                  searchParams.set("page", String(invoiceResult.page + 1));
                  setSearchParams(searchParams);
                }}
              />
            </InlineStack>
          </Box>
        )}
      </BlockStack>
    </Page>
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
