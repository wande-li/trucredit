import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Modal,
  TextField,
  FormLayout,
  Text,
  BlockStack,
  Banner,
  Select,
} from "@shopify/polaris";
import type { CustomerRecord, CreditRecommendation } from "~/types";

interface CreditLimitModalProps {
  open: boolean;
  onClose: () => void;
  customer: CustomerRecord;
  assessment: CreditRecommendation;
}

export function CreditLimitModal({
  open,
  onClose,
  customer,
  assessment,
}: CreditLimitModalProps) {
  const fetcher = useFetcher<{ error?: string }>();
  const [newLimit, setNewLimit] = useState(String(assessment.recommendedLimit));
  const [reason, setReason] = useState("");

  const isBusy = fetcher.state === "submitting";
  const error = fetcher.data?.error;

  const numericNewLimit = parseFloat(newLimit);
  const isOver2x = numericNewLimit > assessment.recommendedLimit * 2;
  const isOver50pct =
    assessment.score < 70 &&
    numericNewLimit > Number(customer.creditLimit) * 1.5;

  const handleSubmit = () => {
    fetcher.submit(
      {
        intent: "set-credit-limit",
        customerId: customer.id,
        newLimit,
        reason: reason || `Manual adjustment from ${customer.creditLimit} to ${newLimit}`,
      },
      { method: "post", action: `/app/customers/${customer.id}` },
    );
  };

  // Close on success
  if (fetcher.data && !fetcher.data.error && fetcher.state === "idle") {
    setTimeout(onClose, 500);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust Credit Limit"
      primaryAction={{
        content: isBusy ? "Saving..." : "Save",
        onAction: handleSubmit,
        disabled: isBusy || !newLimit || isNaN(numericNewLimit) || numericNewLimit <= 0,
        loading: isBusy,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: onClose,
          disabled: isBusy,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {error && <Banner tone="critical">{error}</Banner>}

          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" tone="subdued">
              Current Limit: ${Number(customer.creditLimit).toLocaleString()}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Credit Used: ${Number(customer.creditUsed).toLocaleString()}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              AI Recommended: ${assessment.recommendedLimit.toLocaleString()}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Score: {assessment.score} ({assessment.grade.replace("_", "+")})
            </Text>
          </BlockStack>

          <FormLayout>
            <TextField
              label="New Credit Limit (USD)"
              type="number"
              value={newLimit}
              onChange={setNewLimit}
              autoComplete="off"
              min={0}
              step={100}
              helpText={
                assessment.recommendedLimit > 0
                  ? `AI recommends $${assessment.recommendedLimit.toLocaleString()}`
                  : undefined
              }
              error={
                isOver2x
                  ? `Exceeds 2x recommended limit ($${assessment.recommendedLimit.toLocaleString()})`
                  : isOver50pct
                    ? `Score ${assessment.score} — increases over 50% need review`
                    : undefined
              }
            />

            <TextField
              label="Reason for change"
              value={reason}
              onChange={setReason}
              autoComplete="off"
              placeholder="e.g., customer requested higher limit, seasonal adjustment"
              multiline={2}
            />

            <Select
              label="Quick Preset"
              options={[
                { label: "Custom", value: "" },
                {
                  label: `AI Recommended: $${assessment.recommendedLimit.toLocaleString()}`,
                  value: String(assessment.recommendedLimit),
                },
                { label: "Double current", value: String(Number(customer.creditLimit) * 2) },
                { label: "Set to $5,000", value: "5000" },
                { label: "Set to $10,000", value: "10000" },
              ]}
              onChange={(val) => {
                if (val) setNewLimit(val);
              }}
              value=""
            />
          </FormLayout>

          {assessment.warnings.length > 0 && (
            <Banner tone="warning">
              <BlockStack gap="100">
                {assessment.warnings.map((w, i) => (
                  <Text as="p" variant="bodyMd" key={i}>
                    {w}
                  </Text>
                ))}
              </BlockStack>
            </Banner>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
