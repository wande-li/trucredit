import { useEffect, useState } from "react";
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
interface CreditLimitModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  customerId: string;
  creditLimit: string;
  creditUsed: string;
  recommendation: {
    recommendedLimit: number;
    score: number;
    grade: string;
  };
}

export function CreditLimitModal({
  open,
  onClose,
  onSuccess,
  customerId,
  creditLimit,
  creditUsed,
  recommendation,
}: CreditLimitModalProps) {
  const fetcher = useFetcher<{ error?: string }>();
  const [newLimit, setNewLimit] = useState(String(recommendation.recommendedLimit));
  const [reason, setReason] = useState("");

  const isBusy = fetcher.state === "submitting";
  const error = fetcher.data?.error;

  const numericNewLimit = parseFloat(newLimit);
  const isOver2x = numericNewLimit > recommendation.recommendedLimit * 2;
  const isOver50pct =
    recommendation.score < 70 &&
    numericNewLimit > Number(creditLimit) * 1.5;

  const handleSubmit = () => {
    const fd = new FormData();
    fd.append("intent", "set-credit-limit");
    fd.append("customerId", customerId);
    fd.append("newLimit", newLimit);
    fd.append("reason", reason || `Manual adjustment from ${creditLimit} to ${newLimit}`);
    fetcher.submit(fd, {
      method: "post",
      action: `/app/customers/${customerId}`,
    });
  };

  // Close on success and notify parent
  useEffect(() => {
    if (fetcher.data && !fetcher.data.error && fetcher.state === "idle") {
      onSuccess?.();
      const timer = setTimeout(onClose, 500);
      return () => clearTimeout(timer);
    }
  }, [fetcher.data, fetcher.data?.error, fetcher.state, onClose, onSuccess]);

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
              Current Limit: ${Number(creditLimit).toLocaleString()}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Credit Used: ${Number(creditUsed).toLocaleString()}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              AI Recommended: ${recommendation.recommendedLimit.toLocaleString()}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Score: {recommendation.score} ({recommendation.grade.replace("_", "+")})
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
                recommendation.recommendedLimit > 0
                  ? `AI recommends $${recommendation.recommendedLimit.toLocaleString()}`
                  : undefined
              }
              error={
                isOver2x
                  ? `Exceeds 2x recommended limit ($${recommendation.recommendedLimit.toLocaleString()})`
                  : isOver50pct
                    ? `Score ${recommendation.score} — increases over 50% need review`
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
                  label: `AI Recommended: $${recommendation.recommendedLimit.toLocaleString()}`,
                  value: String(recommendation.recommendedLimit),
                },
                { label: "Double current", value: String(Number(creditLimit) * 2) },
                { label: "Set to $5,000", value: "5000" },
                { label: "Set to $10,000", value: "10000" },
              ]}
              onChange={(val) => {
                if (val) setNewLimit(val);
              }}
              value=""
            />
          </FormLayout>



        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
