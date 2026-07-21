// Settings Page — shop currency, timezone, email preferences
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
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
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import PageSkeleton from "~/components/PageSkeleton";

// ── Constants ──
const TIMEZONES = [
  { label: "Eastern Time (US)", value: "America/New_York" },
  { label: "Central Time (US)", value: "America/Chicago" },
  { label: "Mountain Time (US)", value: "America/Denver" },
  { label: "Pacific Time (US)", value: "America/Los_Angeles" },
  { label: "London (GMT)", value: "Europe/London" },
  { label: "Berlin (CET)", value: "Europe/Berlin" },
  { label: "Tokyo (JST)", value: "Asia/Tokyo" },
  { label: "Shanghai (CST)", value: "Asia/Shanghai" },
  { label: "Sydney (AEST)", value: "Australia/Sydney" },
];

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
  try {
    const { session } = await authenticate.admin(request);
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop.trim() },
      select: { currency: true, timezone: true, emailFromName: true, emailReplyTo: true },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    return json({ settings: shop });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Settings loader failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

// ── Action ──
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent !== "save") {
      return json({ error: "Invalid intent" } satisfies ActionData);
    }

    // P2-6: Validate emailReplyTo format
    const emailReplyTo = (formData.get("emailReplyTo") as string)?.trim() || null;
    if (emailReplyTo) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(emailReplyTo)) {
        return json({
          error: "Invalid email format for Reply-To address",
        } satisfies ActionData);
      }
      if (emailReplyTo.length > 320) {
        return json({
          error: "Email address is too long (max 320 characters)",
        } satisfies ActionData);
      }
    }

    // P2-6: Validate timezone against allowed list
    const timezone = (formData.get("timezone") as string) || "America/New_York";
    if (!TIMEZONES.some((tz) => tz.value === timezone)) {
      return json({
        error: `Invalid timezone: ${timezone}`,
      } satisfies ActionData);
    }

    await prisma.shop.update({
      where: { shopDomain: session.shop.trim() },
      data: {
        currency: (formData.get("currency") as string) || "USD",
        timezone,
        emailFromName: (formData.get("emailFromName") as string) || null,
        emailReplyTo,
      },
    });
    return json({ success: "Settings saved successfully" } satisfies ActionData);
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: `Failed to save settings: ${msg}` } satisfies ActionData);
  }
};

// ── Component ──
export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isSubmitting = fetcher.state === "submitting";
  const [dismissedSuccess, setDismissedSuccess] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);

  // Reset dismiss flags when new fetcher data arrives
  const successMsg =
    fetcher.data && "success" in fetcher.data ? fetcher.data.success : null;
  const errorMsg =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  return (
    <Page fullWidth title="Settings" subtitle="Manage your shop preferences">
      <BlockStack gap="500">
        {/* Success Banner */}
        {successMsg && !dismissedSuccess && (
          <Banner
            tone="success"
            onDismiss={() => setDismissedSuccess(true)}
          >
            <Text as="p" variant="bodyMd">
              {successMsg}
            </Text>
          </Banner>
        )}

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
                setDismissedSuccess(false);
                setDismissedError(false);
              }}
            >
              <input type="hidden" name="intent" value="save" />
              <FormLayout>
                <Select
                  label="Currency"
                  name="currency"
                  options={CURRENCIES}
                  value={settings.currency}
                  helpText="Default currency for invoices and credit limits"
                  disabled={isSubmitting}
                />

                <Select
                  label="Timezone"
                  name="timezone"
                  options={TIMEZONES}
                  value={settings.timezone}
                  helpText="Used for scheduling emails and due date calculations"
                  disabled={isSubmitting}
                />

                <TextField
                  label="Email From Name"
                  name="emailFromName"
                  value={settings.emailFromName ?? ""}
                  autoComplete="off"
                  helpText="Sender name displayed on collection emails (e.g., 'TruCredit Team')"
                  disabled={isSubmitting}
                />

                <TextField
                  label="Email Reply-To"
                  name="emailReplyTo"
                  type="email"
                  value={settings.emailReplyTo ?? ""}
                  autoComplete="email"
                  helpText="Where customer replies will be sent (e.g., 'billing@yourstore.com')"
                  disabled={isSubmitting}
                />

                <Button submit variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : "Save Settings"}
                </Button>
              </FormLayout>
            </fetcher.Form>
          </BlockStack>
        </Card>

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
