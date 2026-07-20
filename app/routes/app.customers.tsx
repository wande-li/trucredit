import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, Link } from "@remix-run/react";
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
  EmptyState,
  Button,
  Box,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { listCustomers } from "~/services/customer.server";
import prisma from "~/db.server";
import { useCallback } from "react";

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
    const creditGrade = url.searchParams.get("creditGrade") ?? undefined;
    const riskLevel = url.searchParams.get("riskLevel") ?? undefined;
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);

    const result = await listCustomers({
      shopId: shop.id,
      search,
      status,
      creditGrade,
      riskLevel,
      page,
    });

    return json({ result, shopDomain });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Response(`Failed to load data: ${msg}`, { status: 500 });
  }
};

export default function CustomersPage() {
  const { result } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { items, page, totalPages, total } = result;

  const handleSearch = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) {
        next.set("search", value);
      } else {
        next.delete("search");
      }
      next.delete("page");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.delete("page");
      setSearchParams(next);
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

  const clearAllFilters = useCallback(() => {
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const statusSelect = searchParams.get("status") ?? "";
  const gradeSelect = searchParams.get("creditGrade") ?? "";
  const riskSelect = searchParams.get("riskLevel") ?? "";

  return (
    <Page
      fullWidth
      title="Customers"
      subtitle={`${total} total`}
      primaryAction={<Button url="/app/customers/new" variant="primary">Add Customer</Button>}
    >
      <BlockStack gap="400">
        {/* Filters */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" align="space-between" blockAlign="end">
              <div style={{ flex: 1, maxWidth: 360 }}>
                <TextField
                  label="Search"
                  value={searchParams.get("search") ?? ""}
                  onChange={handleSearch}
                  autoComplete="off"
                  placeholder="Search by name, company, or email..."
                  clearButton
                  onClearButtonClick={() => handleSearch("")}
                />
              </div>
              <Select
                label="Status"
                options={[
                  { label: "All", value: "" },
                  { label: "Active", value: "ACTIVE" },
                  { label: "Frozen", value: "FROZEN" },
                  { label: "Blacklisted", value: "BLACKLISTED" },
                ]}
                value={statusSelect}
                onChange={(v) => handleFilterChange("status", v)}
              />
              <Select
                label="Grade"
                options={[
                  { label: "All", value: "" },
                  { label: "A+", value: "A_PLUS" },
                  { label: "A", value: "A" },
                  { label: "B", value: "B" },
                  { label: "C", value: "C" },
                  { label: "D", value: "D" },
                  { label: "F", value: "F" },
                ]}
                value={gradeSelect}
                onChange={(v) => handleFilterChange("creditGrade", v)}
              />
              <Select
                label="Risk Level"
                options={[
                  { label: "All", value: "" },
                  { label: "Low", value: "LOW" },
                  { label: "Medium", value: "MEDIUM" },
                  { label: "High", value: "HIGH" },
                  { label: "Critical", value: "CRITICAL" },
                ]}
                value={riskSelect}
                onChange={(v) => handleFilterChange("riskLevel", v)}
              />
            </InlineStack>

            {(statusSelect || gradeSelect || riskSelect) && (
              <InlineStack gap="200">
                <Button onClick={clearAllFilters} variant="plain">
                  Clear all filters
                </Button>
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        {/* Table */}
        {items.length === 0 ? (
          <Card>
            <EmptyState
              heading="No customers found"
              image=""
            >
              <Text as="p" variant="bodyMd">
                {searchParams.toString()
                  ? "Try adjusting your filters or search terms."
                  : "Sync customers from Shopify to start managing credit."}
              </Text>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{
                singular: "customer",
                plural: "customers",
              }}
              itemCount={items.length}
              headings={[
                { title: "Customer" },
                { title: "Grade" },
                { title: "Risk" },
                { title: "Status" },
                { title: "Credit Used / Limit" },
                { title: "Orders" },
                { title: "Overdue" },
              ]}
              selectable={false}
            >
              {items.map(
                (
                  {
                    id,
                    name,
                    company,
                    email,
                    creditGrade,
                    riskLevel,
                    status,
                    isFrozen,
                    creditUsed,
                    creditLimit,
                    totalOrders,
                    overdueCount,
                    invoiceCount,
                  },
                  index,
                ) => (
                  <IndexTable.Row id={id} key={id} position={index}>
                    <IndexTable.Cell>
                      <Link to={`/app/customers/${id}`}>
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd" fontWeight="bold">
                            {name}
                          </Text>
                          {company && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              {company}
                            </Text>
                          )}
                          <Text as="span" variant="bodySm" tone="subdued">
                            {email}
                          </Text>
                        </BlockStack>
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {creditGrade ? (
                        <Badge
                          tone={
                            creditGrade === "A_PLUS" || creditGrade === "A"
                              ? "success"
                              : creditGrade === "B"
                                ? "new"
                                : creditGrade === "C"
                                  ? "warning"
                                  : "critical"
                          }
                        >
                          {creditGrade.replace("_", "+")}
                        </Badge>
                      ) : (
                        <Text as="span" tone="subdued" variant="bodyMd">
                          —
                        </Text>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge
                        tone={
                          riskLevel === "LOW"
                            ? "success"
                            : riskLevel === "MEDIUM"
                              ? "warning"
                              : "critical"
                        }
                      >
                        {riskLevel}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge
                        tone={
                          isFrozen || status === "BLACKLISTED"
                            ? "critical"
                            : status === "ACTIVE"
                              ? "success"
                              : "attention"
                        }
                      >
                        {isFrozen ? "FROZEN" : status}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        ${Number(creditUsed).toLocaleString()} / $
                        {Number(creditLimit).toLocaleString()}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        {totalOrders}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {overdueCount > 0 ? (
                        <Badge tone="critical">{String(overdueCount)}</Badge>
                      ) : (
                        <Text as="span" variant="bodyMd">
                          {invoiceCount > 0 ? "0" : "—"}
                        </Text>
                      )}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ),
              )}
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
    </Page>
  );
}
