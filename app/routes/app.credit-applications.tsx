// Credit Applications — merchant review queue for B2B self-registration
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate, useSearchParams, useRevalidator } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  IndexTable,
  Badge,
  Button,
  EmptyState,
  Box,
  Banner,
  Select,
  Modal,
  TextField,
  Pagination,
} from "@shopify/polaris";
import { resolveShop } from "~/services/shop-resolver.server";
import { approveApplication, rejectApplication } from "~/services/registration.server";
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import PageSkeleton from "~/components/PageSkeleton";
import { useCallback, useState } from "react";

export const meta: MetaFunction = () => [{ title: "TruCredit — Credit Applications" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:app.credit-applications START");
  try {
    const { shopId } = await resolveShop(request);

    const url = new URL(request.url);
    const statusFilter = (url.searchParams.get("status") ?? "PENDING") as "PENDING" | "APPROVED" | "REJECTED";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const perPage = 20;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [applications, totalCount, stalePendingCount, totalPendingCount] = await Promise.all([
      prisma.creditApplication.findMany({
        where: { shopId, status: statusFilter },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true, companyName: true, contactEmail: true,
          yearsInBusiness: true, companySize: true, annualRevenue: true,
          requestedCredit: true, coldStartScore: true, autoApproved: true,
          status: true, approvedLimit: true, reviewNotes: true, createdAt: true,
        },
      }),
      prisma.creditApplication.count({ where: { shopId, status: statusFilter } }),
      // GAP 3: Count stale PENDING applications (older than 7 days)
      prisma.creditApplication.count({
        where: { shopId, status: "PENDING", createdAt: { lt: sevenDaysAgo } },
      }),
      // GAP 3: Total PENDING count (for the "Pending" tab badge)
      prisma.creditApplication.count({ where: { shopId, status: "PENDING" } }),
    ]);

    logger.app("INFO", "loader:app.credit-applications OK", null, {
      durationMs: Date.now() - t0,
      count: applications.length,
      totalCount,
      page,
      statusFilter,
      stalePendingCount,
      totalPendingCount,
    });

    return json({ applications, statusFilter, totalCount, page, perPage, stalePendingCount, totalPendingCount });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:app.credit-applications ERROR", msg, { durationMs: Date.now() - t0 });
    throw new Response("We encountered an issue. Please refresh the page and try again.", { status: 500 });
  }
};

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const _intent = String(formData.get("_intent") ?? "");

  // P1-3: Batch approve
  if (_intent === "batch-approve") {
    const ids = String(formData.get("applicationIds") ?? "").split(",").filter(Boolean);
    if (ids.length === 0) {
      return json({ error: "No applications selected." }, { status: 400 });
    }
    try {
      const { shopId } = await resolveShop(request);
      let ok = 0;
      let fail = 0;
      for (const applicationId of ids) {
        try {
          await approveApplication({ applicationId, shopId, reviewerId: "merchant" });
          ok++;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "action:batch-approve single fail", msg, { applicationId });
          fail++;
        }
      }
      logger.app("INFO", "action:batch-approve OK", null, { ok, fail, total: ids.length });
      return json({ success: true, action: "batch-approved", ok, fail });
    } catch (e: unknown) {
      if (e instanceof Response) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("ERROR", "action:batch-approve ERROR", msg);
      return json({ error: "Batch approve failed. Please try again." }, { status: 500 });
    }
  }

  const applicationId = String(formData.get("applicationId") ?? "");

  if (!applicationId) {
    return json({ error: "Application ID is required." }, { status: 400 });
  }

  try {
    const { shopId } = await resolveShop(request);

    if (_intent === "approve") {
      const customLimitStr = formData.get("customLimit");
      const customLimitParsed = customLimitStr ? Number(customLimitStr) : undefined;
    if (customLimitStr && (isNaN(customLimitParsed!) || customLimitParsed! <= 0)) {
      return json({ error: "Please enter a valid credit limit amount." }, { status: 400 });
    }
    const customLimit = customLimitParsed;
      const result = await approveApplication({
        applicationId,
        shopId,
        reviewerId: "merchant",
        customLimit,
      });
      return json({ success: true, action: "approved", ...result });
    }

    if (_intent === "reject") {
      const notes = String(formData.get("notes") ?? "");
      const result = await rejectApplication({
        applicationId,
        shopId,
        reviewerId: "merchant",
        notes: notes || undefined,
      });
      return json({ success: true, action: "rejected", ...result });
    }

    return json({ error: "Invalid intent." }, { status: 400 });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "action:app.credit-applications ERROR", msg);
    return json({ error: "We encountered an issue. Please refresh the page and try again." }, { status: 500 });
  }
}

function statusBadge(status: string): { tone: "attention" | "success" | "critical"; label: string } {
  switch (status) {
    case "APPROVED":
      return { tone: "success", label: "Approved" };
    case "REJECTED":
      return { tone: "critical", label: "Rejected" };
    default:
      return { tone: "attention", label: "Pending" };
  }
}

export default function CreditApplicationsPage() {
  const { applications, statusFilter, totalCount, page, perPage, stalePendingCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; action?: string; error?: string; portalUrl?: string; ok?: number; fail?: number }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [selectedStatus, setSelectedStatus] = useState(statusFilter);
  const [approveTarget, setApproveTarget] = useState<{ id: string; name: string; requested: number } | null>(null);
  const [customLimit, setCustomLimit] = useState("");
  const [selectedResources, setSelectedResources] = useState<string[]>([]);

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const isPendingTab = statusFilter === "PENDING";

  const handleStatusFilter = useCallback(
    (value: string) => {
      setSelectedStatus(value);
      const params = new URLSearchParams(searchParams);
      params.set("status", value);
      params.delete("page");
      navigate(`?${params.toString()}`);
    },
    [searchParams, navigate],
  );

  const goToPage = useCallback((newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    navigate(`?${params.toString()}`);
  }, [searchParams, navigate]);

  const handleOpenApprove = useCallback((id: string, name: string, requested: number) => {
    setApproveTarget({ id, name, requested });
    setCustomLimit(String(requested));
  }, []);

  const handleCloseApprove = useCallback(() => {
    setApproveTarget(null);
    setCustomLimit("");
  }, []);

  const handleSelectionChange = useCallback(
    (selected: string[]) => {
      setSelectedResources(selected);
    },
    [],
  );

  const isProcessing = fetcher.state !== "idle";

  return (
    <Page
      fullWidth
      title="Credit Applications"
      subtitle="Review and manage B2B self-registration applications"
    >
      {fetcher.data?.success && (
        <Box paddingBlockEnd="400">
          <Banner tone="success" onDismiss={() => revalidator.revalidate()}>
            <BlockStack gap="200">
              {fetcher.data.action === "batch-approved" ? (
                <Text as="p">
                  Batch approve complete: {fetcher.data.ok} succeeded{fetcher.data.fail ? `, ${fetcher.data.fail} failed` : ""}.
                </Text>
              ) : (
                <>
                  <Text as="p">
                    Application {fetcher.data.action === "approved" ? "approved" : "rejected"} successfully.
                  </Text>
                  {fetcher.data.action === "approved" && fetcher.data.portalUrl && (
                    <Text as="p" variant="bodySm">
                      Buyer Portal:{" "}
                      <a href={fetcher.data.portalUrl} target="_blank" rel="noopener noreferrer">
                        {fetcher.data.portalUrl}
                      </a>
                    </Text>
                  )}
                </>
              )}
              <Button variant="plain" onClick={() => revalidator.revalidate()}>
                Refresh list
              </Button>
            </BlockStack>
          </Banner>
        </Box>
      )}

      {fetcher.data?.error && (
        <Box paddingBlockEnd="400">
          <Banner tone="critical" onDismiss={() => fetcher.load("/app/credit-applications")}>
            <Text as="p">{fetcher.data.error}</Text>
          </Banner>
        </Box>
      )}

      {/* GAP 3: Stale pending applications warning */}
      {stalePendingCount > 0 && (
        <Box paddingBlockEnd="400">
          <Banner tone="warning">
            <Text as="p" variant="bodyMd">
              {stalePendingCount} application{stalePendingCount !== 1 ? "s" : ""} pending for over 7 days. Promptly reviewing applications ensures your B2B customers aren't left waiting.
            </Text>
          </Banner>
        </Box>
      )}

      <BlockStack gap="400">
        {/* Status Filter + Batch Actions */}
        <Card>
          <InlineStack gap="300" align="space-between" blockAlign="center">
            <InlineStack gap="300" blockAlign="center">
              <Select
                label="Filter by status"
                options={[
                  { label: "Pending", value: "PENDING" },
                  { label: "Approved", value: "APPROVED" },
                  { label: "Rejected", value: "REJECTED" },
                ]}
                value={selectedStatus}
                onChange={handleStatusFilter}
              />
              <Text as="p" variant="bodyMd" tone="subdued">
                {totalCount} application{totalCount !== 1 ? "s" : ""} total
              </Text>
            </InlineStack>
            {isPendingTab && selectedResources.length > 0 && (
              <Button
                variant="primary"
                tone="success"
                disabled={isProcessing}
                onClick={() => {
                  const form = new FormData();
                  form.append("_intent", "batch-approve");
                  form.append("applicationIds", selectedResources.join(","));
                  fetcher.submit(form, { method: "post" });
                  setSelectedResources([]);
                }}
              >
                Batch Approve ({selectedResources.length})
              </Button>
            )}
          </InlineStack>
        </Card>

        {/* Table */}
        {applications.length === 0 ? (
          <Card>
            <EmptyState heading="No applications found" image="">
              <Text as="p" variant="bodyMd">
                {statusFilter === "PENDING"
                  ? "No pending applications to review."
                  : `No ${statusFilter.toLowerCase()} applications found.`}
              </Text>
            </EmptyState>
          </Card>
        ) : (
          <>
          <Card padding="0">
            <IndexTable
              resourceName={{
                singular: "application",
                plural: "applications",
              }}
              itemCount={applications.length}
              headings={[
                { title: "Company" },
                { title: "Profile" },
                { title: "Score" },
                { title: "Requested" },
                { title: "Status" },
                { title: "Date" },
                { title: "Actions" },
              ]}
              selectable={isPendingTab}
              selectedResources={selectedResources}
              onSelectionChange={handleSelectionChange}
            >
              {applications.map((app, index) => {
                const badge = statusBadge(app.status);
                return (
                  <IndexTable.Row id={app.id} key={app.id} position={index}>
                    <IndexTable.Cell>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodyMd" fontWeight="bold">
                          {app.companyName}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {app.contactEmail}
                        </Text>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm">
                          {app.yearsInBusiness}y in business
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {app.companySize} &middot; ${Number(app.annualRevenue).toLocaleString("en-US")} rev
                        </Text>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {app.coldStartScore != null ? (
                        <Badge
                          tone={
                            app.coldStartScore >= 70 ? "success"
                            : app.coldStartScore >= 50 ? "attention"
                            : "critical"
                          }
                        >
                          {`${app.coldStartScore}/100`}
                        </Badge>
                      ) : (
                        <Text as="span" tone="subdued" variant="bodyMd">—</Text>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        ${Number(app.requestedCredit).toLocaleString("en-US")}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {new Date(app.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {app.status === "PENDING" ? (
                        <InlineStack gap="200">
                          <Button
                            variant="primary"
                            size="slim"
                            disabled={isProcessing}
                            onClick={() => handleOpenApprove(app.id, app.companyName, Number(app.requestedCredit))}
                          >
                            Approve
                          </Button>
                          <fetcher.Form method="post">
                            <input type="hidden" name="_intent" value="reject" />
                            <input type="hidden" name="applicationId" value={app.id} />
                            <Button
                              variant="tertiary"
                              tone="critical"
                              size="slim"
                              submit
                              disabled={isProcessing}
                            >
                              Reject
                            </Button>
                          </fetcher.Form>
                        </InlineStack>
                      ) : app.status === "APPROVED" ? (
                        <Text as="span" variant="bodySm" tone="success">
                          ${Number(app.approvedLimit ?? 0).toLocaleString("en-US")} limit
                        </Text>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {app.reviewNotes ?? "—"}
                        </Text>
                      )}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          </Card>
          {totalPages > 1 && (
            <Box paddingBlockStart="200">
              <Pagination
                hasPrevious={page > 1}
                hasNext={page < totalPages}
                onPrevious={() => goToPage(page - 1)}
                onNext={() => goToPage(page + 1)}
                label={`Page ${page} of ${totalPages}`}
              />
            </Box>
          )}
          </>
        )}
      </BlockStack>

      {/* Custom Credit Limit Modal */}
      {approveTarget && (
        <Modal
          open
          title={`Approve ${approveTarget.name}`}
          primaryAction={{
            content: "Approve",
            onAction: () => {
              const form = new FormData();
              form.append("_intent", "approve");
              form.append("applicationId", approveTarget.id);
              form.append("customLimit", customLimit);
              fetcher.submit(form, { method: "post" });
              handleCloseApprove();
            },
          }}
          secondaryActions={[{ content: "Cancel", onAction: handleCloseApprove }]}
          onClose={handleCloseApprove}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Credit Limit (USD)"
                type="number"
                value={customLimit}
                onChange={setCustomLimit}
                autoComplete="off"
                helpText={`Requested: $${approveTarget.requested.toLocaleString("en-US")}`}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                The buyer will receive an email with a link to their payment portal.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

export function HydrateFallback() {
  return <PageSkeleton />;
}
