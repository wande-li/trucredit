import { Badge, InlineStack } from "@shopify/polaris";
import type { CreditGrade, RiskLevel, CustomerStatus } from "@prisma/client";

interface CustomerStatusBadgeProps {
  status?: CustomerStatus | null;
  riskLevel?: RiskLevel | null;
  creditGrade?: CreditGrade | null;
  isFrozen?: boolean;
}

const STATUS_TONE: Record<string, "success" | "critical" | "attention" | "new"> = {
  ACTIVE: "success",
  FROZEN: "critical",
  BLACKLISTED: "critical",
};

const RISK_TONE: Record<string, "success" | "warning" | "critical"> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "critical",
  CRITICAL: "critical",
};

const GRADE_TONE: Record<string, "success" | "new" | "warning" | "critical"> = {
  A_PLUS: "success",
  A: "success",
  B: "new",
  C: "warning",
  D: "critical",
  F: "critical",
};

export function CustomerStatusBadge({
  status,
  riskLevel,
  creditGrade,
  isFrozen,
}: CustomerStatusBadgeProps) {
  const badges: React.ReactNode[] = [];

  if (isFrozen) {
    badges.push(
      <Badge key="frozen" tone="critical">
        FROZEN
      </Badge>,
    );
  } else if (status) {
    badges.push(
      <Badge key="status" tone={STATUS_TONE[status] ?? "new"}>
        {status === "BLACKLISTED" ? "BLACKLISTED" : status}
      </Badge>,
    );
  }

  if (riskLevel && riskLevel !== "MEDIUM") {
    badges.push(
      <Badge key="risk" tone={RISK_TONE[riskLevel]}>
        {riskLevel}
      </Badge>,
    );
  }

  if (creditGrade) {
    badges.push(
      <Badge key="grade" tone={GRADE_TONE[creditGrade] ?? "new"}>
        {creditGrade.replace("_", "+")}
      </Badge>,
    );
  }

  return (
    <InlineStack gap="200" wrap={false}>
      {badges}
    </InlineStack>
  );
}
