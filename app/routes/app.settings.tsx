// Settings Page — shop currency, timezone, email preferences
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";

import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  Spinner,
  Box,
  InlineStack,
  Badge,
  Modal,
} from "@shopify/polaris";
import { ClipboardIcon } from "@shopify/polaris-icons";
import { resolveShop } from "~/services/shop-resolver.server";
import { requirePermission, getAvailableActions } from "~/services/rbac.server";
import prisma from "~/db.server";
import { checkPlanAccess } from "~/services/billing.server";
import { logger } from "~/services/logger.server";
import { ROLE_LABELS, type Role } from "~/lib/constants";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import PageSkeleton from "~/components/PageSkeleton";
import ActionToast from "~/components/ActionToast";

export const meta: MetaFunction = () => [{ title: "TruCredit — Settings" }];

// ── Constants ──
const CURRENCIES = [
  { label: "USD — US Dollar", value: "USD" },
  { label: "EUR — Euro", value: "EUR" },
  { label: "GBP — British Pound", value: "GBP" },
  { label: "CAD — Canadian Dollar", value: "CAD" },
  { label: "AUD — Australian Dollar", value: "AUD" },
  { label: "JPY — Japanese Yen", value: "JPY" },
  { label: "CNY — Chinese Yuan", value: "CNY" },
];

type ActionData = {
  success?: string;
  error?: string;
};

// ── Loader ──
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:app.settings START");
  try {
    const { shopDomain, shopId, role } = await resolveShop(request);

    // Plan gate
    const { isPaid } = await checkPlanAccess(shopId);
    if (!isPaid) return redirect("/app/billing");

    const [shop, teamMembers] = await Promise.all([
      prisma.shop.findUnique({
        where: { shopDomain },
        select: { currency: true, emailFromName: true, emailReplyTo: true },
      }),
      prisma.teamMember.findMany({
        where: { shopId },
        select: { id: true, email: true, role: true, assignedAt: true },
        orderBy: { assignedAt: "asc" },
      }),
    ]);

    if (!shop) throw new Response("Store not found.", { status: 404 });

    logger.app("INFO", "loader:app.settings OK", null, {
      durationMs: Date.now() - t0,
      role,
      teamMemberCount: teamMembers.length,
    });
    return json({
      settings: shop,
      shopDomain,
      role,
      roleLabel: ROLE_LABELS[role],
      permissions: getAvailableActions(role),
      teamMembers,
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:app.settings ERROR", msg, { durationMs: Date.now() - t0 });
    throw new Response("We encountered an issue. Please refresh the page and try again.", { status: 500 });
  }
};

// ── Action ──
export const action = async ({ request }: ActionFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "action:app.settings START");
  try {
    const { shopDomain, role, shopId } = await resolveShop(request);
    requirePermission(role, "edit");

    // Plan gate
    const { isPaid } = await checkPlanAccess(shopId);
    if (!isPaid) {
      logger.app("WARN", "action:app.settings plan_gate blocked", null, { shopId });
      return json({ error: "Settings management requires a paid plan. Please upgrade." } satisfies ActionData);
    }

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent !== "save") {
      logger.app("WARN", "action:app.settings invalid_intent", null, { intent });
      return json({ error: "We encountered an issue. Please refresh the page and try again." } satisfies ActionData);
    }

    // P2-6: Validate emailReplyTo format
    const emailReplyTo = String(formData.get("emailReplyTo") ?? "").trim() || null;
    if (emailReplyTo) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(emailReplyTo)) {
        return json({
          error: "Please enter a valid email address for Reply-To.",
        } satisfies ActionData);
      }
      if (emailReplyTo.length > 320) {
        return json({
          error: "Please enter an email address under 320 characters.",
        } satisfies ActionData);
      }
    }

    await prisma.shop.update({
      where: { shopDomain },
      data: {
        currency: String(formData.get("currency") ?? "") || "USD",
        emailFromName: String(formData.get("emailFromName") ?? "") || null,
        emailReplyTo,
      },
    });
    logger.app("INFO", "action:app.settings save OK", null, { durationMs: Date.now() - t0 });
    return json({ success: "Settings saved successfully" } satisfies ActionData);
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "action:app.settings ERROR", msg, { durationMs: Date.now() - t0 });
    return json({ error: "Unable to save settings. Please try again." } satisfies ActionData);
  }
};

// ── Component ──
function roleBadgeTone(role: Role): "success" | "attention" | "info" {
  if (role === "admin") return "success";
  if (role === "manager") return "attention";
  return "info";
}

export default function SettingsPage() {
  const { settings, shopDomain, role, roleLabel, permissions, teamMembers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const teamFetcher = useFetcher<{ success?: boolean; error?: string; member?: { id: string; email: string; role: string } }>();
  const isSubmitting = fetcher.state === "submitting";
  const [dismissedError, setDismissedError] = useState(false);
  const [copied, setCopied] = useState(false);

  const registrationLink = `https://${shopDomain}/apps/trucredit/register`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(registrationLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text manually
      const el = document.createElement("textarea");
      el.value = registrationLink;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [registrationLink]);

  // Form field state — needed because Polaris TextField/Select requires onChange for controlled value
  const [emailFromName, setEmailFromName] = useState(settings.emailFromName ?? "");
  const [emailReplyTo, setEmailReplyTo] = useState(settings.emailReplyTo ?? "");
  const [currency, setCurrency] = useState(settings.currency ?? "USD");

  // Sync local state when settings reload (e.g., after successful save via fetcher.Form)
  useEffect(() => {
    setEmailFromName(settings.emailFromName ?? "");
    setEmailReplyTo(settings.emailReplyTo ?? "");
    setCurrency(settings.currency ?? "USD");
    setDismissedError(false);
  }, [settings]);

  // Team member modal state
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("viewer");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState("viewer");
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  // Error message from fetcher data
  const errorMsg =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  return (
    <Page fullWidth title="Settings" subtitle="Manage your shop preferences">
      <ActionToast fetcher={fetcher} successMessage="Settings saved successfully" />
      <BlockStack gap="500">
        {/* Error Banner */}
        {errorMsg && !dismissedError && (
          <Banner
            tone="critical"
            onDismiss={() => setDismissedError(true)}
          >
            <Text as="p" variant="bodyMd">
              {errorMsg}
            </Text>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              General Settings
            </Text>

            <fetcher.Form
              method="post"
              onSubmit={() => {
                setDismissedError(false);
              }}
            >
              <input type="hidden" name="intent" value="save" />
              <FormLayout>
            <Select
              label="Currency"
              name="currency"
              options={CURRENCIES}
              value={currency}
              onChange={setCurrency}
              helpText="Default currency for invoices and credit limits"
              disabled={isSubmitting}
            />

            <TextField
                  label="Email From Name"
                  name="emailFromName"
                  value={emailFromName}
                  onChange={setEmailFromName}
                  autoComplete="off"
                  helpText="Sender name displayed on collection emails (e.g., 'TruCredit Team')"
                  disabled={isSubmitting}
                />

                <TextField
                  label="Email Reply-To"
                  name="emailReplyTo"
                  type="email"
                  value={emailReplyTo}
                  onChange={setEmailReplyTo}
                  autoComplete="email"
                  helpText="Where customer replies will be sent (e.g., 'billing@yourstore.com')"
                  disabled={isSubmitting}
                />

                {settings.emailFromName || settings.emailReplyTo ? (
                  <Text as="p" tone="subdued">
                    Collection emails will be sent from <strong>{settings.emailFromName || "TruCredit"}</strong>
                    {settings.emailReplyTo ? <> with replies directed to <strong>{settings.emailReplyTo}</strong></> : ""}.
                  </Text>
                ) : (
                  <Text as="p" tone="subdued">
                    Customize the sender name and reply-to address for collection emails. If left empty, system defaults will be used.
                  </Text>
                )}

                <Button submit variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : "Save Settings"}
                </Button>
              </FormLayout>
            </fetcher.Form>
          </BlockStack>
        </Card>

        {/* ═══ Buyer Registration Link ═══ */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Buyer Registration Link
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Share this link with your wholesale buyers so they can apply for Net Terms.
              It opens on your own store domain for maximum trust.
            </Text>
            <Box
              background="bg-surface-secondary"
              padding="300"
              borderRadius="200"
            >
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <Box
                  background="bg-surface"
                  padding="200"
                  borderRadius="200"
                  width="100%"
                >
                  <Text as="p" variant="bodySm" fontWeight="medium" breakWord>
                    {registrationLink}
                  </Text>
                </Box>
                <Button
                  onClick={handleCopy}
                  icon={ClipboardIcon}
                  variant={copied ? "primary" : "secondary"}
                >
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </InlineStack>
            </Box>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                <strong>Where to place this link:</strong>
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • Add to your wholesale / B2B information page
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • Include in your Net Terms invitation email to buyers
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • Link from your B2B registration form or checkout page
              </Text>
            </BlockStack>
          </BlockStack>
        </Card>

        {/* ═══ Role & Permissions ═══ */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Role & Permissions
            </Text>
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodyMd" tone="subdued">
                Your role:
              </Text>
              <Badge tone={roleBadgeTone(role)}>{roleLabel}</Badge>
            </InlineStack>
            <BlockStack gap="200">
              <Text as="span" variant="bodyMd" tone="subdued">
                Allowed actions:
              </Text>
              <InlineStack gap="200" wrap>
                {permissions.map((perm) => (
                  <Badge key={perm} tone="info">
                    {perm.replace(/_/g, " ")}
                  </Badge>
                ))}
              </InlineStack>
            </BlockStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Role is now derived from Team Member assignments. Account owners default to Admin. Invite team members below with specific roles to control what they can do.
            </Text>
          </BlockStack>
        </Card>

        {/* Team Members (Admin only) */}
        {role === "admin" && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Team Members
                </Text>
                <Button
                  onClick={() => {
                    setNewMemberEmail("");
                    setNewMemberRole("viewer");
                    setShowAddMember(true);
                  }}
                  variant="primary"
                >
                  Add Member
                </Button>
              </InlineStack>

              {teamMembers.length === 0 ? (
                <Text as="p" variant="bodyMd" tone="subdued">
                  No team members yet. Add members to assign specific roles (manager, viewer) to your collaborators.
                </Text>
              ) : (
                <BlockStack gap="200">
                  {teamMembers.map((member) => (
                    <InlineStack key={member.id} align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {member.email}
                        </Text>
                        {editingMemberId === member.id ? (
                          <Select
                            label=""
                            labelHidden
                            options={[
                              { label: "Admin", value: "admin" },
                              { label: "Manager", value: "manager" },
                              { label: "Viewer", value: "viewer" },
                            ]}
                            value={editingRole}
                            onChange={setEditingRole}
                          />
                        ) : (
                          <Badge tone={member.role === "admin" ? "success" : member.role === "manager" ? "attention" : "info"}>
                            {member.role}
                          </Badge>
                        )}
                      </InlineStack>
                      <InlineStack gap="100">
                        {editingMemberId === member.id ? (
                          <>
                            <Button
                              size="slim"
                              variant="primary"
                              onClick={() => {
                                teamFetcher.submit(
                                  { intent: "update-team-member", memberId: member.id, role: editingRole },
                                  { method: "POST", action: "/api/team-members" },
                                );
                                setEditingMemberId(null);
                              }}
                            >
                              Save
                            </Button>
                            <Button
                              size="slim"
                              onClick={() => setEditingMemberId(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="slim"
                            onClick={() => {
                              setEditingMemberId(member.id);
                              setEditingRole(member.role);
                            }}
                          >
                            Edit Role
                          </Button>
                        )}
                        <Button
                          size="slim"
                          tone="critical"
                          onClick={() => {
                            if (removeConfirmId === member.id) {
                              setRemoveConfirmId(null);
                              teamFetcher.submit(
                                { intent: "remove-team-member", memberId: member.id },
                                { method: "POST", action: "/api/team-members" },
                              );
                            } else {
                              setRemoveConfirmId(member.id);
                            }
                          }}
                        >
                          {removeConfirmId === member.id ? "Confirm Remove?" : "Remove"}
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}

        {/* Team member result banner */}
        {teamFetcher.data?.error && (
          <Banner tone="critical" onDismiss={() => teamFetcher.load("/app/settings")}>
            <Text as="p">{teamFetcher.data.error}</Text>
          </Banner>
        )}

        {/* Submission indicator */}
        {isSubmitting && (
          <Box padding="400">
            <InlineStack align="center" gap="200">
              <Spinner size="small" />
              <Text as="span" variant="bodyMd" tone="subdued">
                Saving settings…
              </Text>
            </InlineStack>
          </Box>
        )}
      </BlockStack>

      {/* Add Member Modal */}
      {showAddMember && (
        <Modal
          open={showAddMember}
          onClose={() => setShowAddMember(false)}
          title="Add Team Member"
          primaryAction={{
            content: "Add Member",
            onAction: () => {
              teamFetcher.submit(
                { intent: "add-team-member", email: newMemberEmail, role: newMemberRole },
                { method: "POST", action: "/api/team-members" },
              );
              setShowAddMember(false);
            },
            disabled: !newMemberEmail.includes("@"),
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setShowAddMember(false) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Email"
                type="email"
                value={newMemberEmail}
                onChange={setNewMemberEmail}
                autoComplete="email"
                placeholder="collaborator@example.com"
                helpText="The collaborator's email address. They must already have access to this Shopify store."
              />
              <Select
                label="Role"
                options={[
                  { label: "Admin — Full access", value: "admin" },
                  { label: "Manager — Edit & manage (no billing)", value: "manager" },
                  { label: "Viewer — Read only", value: "viewer" },
                ]}
                value={newMemberRole}
                onChange={setNewMemberRole}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
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
