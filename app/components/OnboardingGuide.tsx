// TruCredit OnboardingGuide — First-time user walkthrough
// Shown when no customers exist yet. 5 steps to get started.
import {
  Card,
  BlockStack,
  Text,
  Button,
  Box,
  InlineStack,
} from "@shopify/polaris";

export default function OnboardingGuide() {
  const STEPS = [
    {
      step: "Step 1",
      title: "Sync B2B Customers",
      desc: "Import customers from Shopify who should get Net Terms. TruCredit will automatically create credit profiles with recommended credit limits based on order history. You can also add customers manually.",
      action: "/app/customers",
      actionLabel: "Manage Customers",
    },
    {
      step: "Step 2",
      title: "Set Credit Limits",
      desc: "Assign credit limits to each customer. TruCredit uses AI to recommend limits based on payment patterns and order volume. You can adjust limits manually at any time.",
      action: "/app/customers",
      actionLabel: "Review Credit Limits",
    },
    {
      step: "Step 3",
      title: "Create Net Terms Invoices",
      desc: "Generate invoices for B2B orders with Net 30/60/90 payment terms. TruCredit tracks due dates, sends automated reminders, and monitors payment status automatically.",
      action: "/app/invoices",
      actionLabel: "Manage Invoices",
    },
    {
      step: "Step 4",
      title: "Set Up Collection Rules",
      desc: "Configure automated email sequences for payment reminders. Define the tone, timing, and escalation rules. TruCredit's AI generates personalized collection emails based on customer behavior.",
      action: "/app/rules",
      actionLabel: "Configure Rules",
    },
    {
      step: "Step 5",
      title: "Monitor AR Aging Dashboard",
      desc: "Track real-time Accounts Receivable aging, DSO, overdue amounts, and collection task progress. The dashboard shows you everything at a glance — come back anytime.",
      action: null,
      actionLabel: null,
    },
  ];

  return (
    <Card padding="500">
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h2" variant="headingLg">
            Welcome to TruCredit
          </Text>
          <Text as="p" variant="bodyLg" tone="subdued">
            Automate B2B credit management and AR collections for your Shopify
            store. Complete these steps to get started:
          </Text>
        </BlockStack>

        <BlockStack gap="0">
          {STEPS.map((s, i) => (
            <Box
              key={i}
              padding="400"
              borderBlockEndWidth={i < STEPS.length - 1 ? "025" : undefined}
              borderColor="border"
            >
              <InlineStack gap="400" blockAlign="start" wrap>
                <Box minWidth="36px">
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "var(--p-color-bg-fill-brand)",
                      color: "var(--p-color-text-brand-on-bg-fill)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </div>
                </Box>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <BlockStack gap="150">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {s.step}
                      </Text>
                      <Text as="h3" variant="headingSm">
                        {s.title}
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodyLg" tone="subdued">
                      {s.desc}
                    </Text>

                    {s.action && s.actionLabel && (
                      <Box paddingBlockStart="200">
                        <Button url={s.action} size="medium">
                          {s.actionLabel} →
                        </Button>
                      </Box>
                    )}

                    {i === 4 && (
                      <Box paddingBlockStart="100">
                        <Text as="p" variant="bodyMd" tone="subdued">
                          You're already here — this dashboard updates in
                          real-time as customers pay and invoices become due.
                        </Text>
                      </Box>
                    )}
                  </BlockStack>
                </div>
              </InlineStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
