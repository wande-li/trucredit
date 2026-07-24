// TruCredit QuickTips — Contextual, data-driven tips for returning users.
// Prioritizes tips based on what the merchant hasn't set up yet.
// Shown on Dashboard when >=1 customer exists. Dismissed via cookie or auto-hide when fully set up.
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  BlockStack,
  Text,
  Link,
  Box,
  InlineStack,
  ProgressBar,
  Button,
} from "@shopify/polaris";

interface Tip {
  title: string;
  body: string;
  link: string;
  linkLabel: string;
  /** Priority filter: tip shown only when this condition is unmet */
  condition?: (s: QuickTipsProps) => boolean;
}

const TIPS: Tip[] = [
  {
    title: "Import Your Customers",
    body: "Sync Shopify B2B customers to start tracking credit limits, risk grades, and payment history.",
    link: "/app/customers",
    linkLabel: "Go to Customers",
    condition: (s) => s.totalCustomers === 0 || s.totalCustomers <= s.totalInvoices,
  },
  {
    title: "Create Your First Invoice",
    body: "Issue net-terms invoices directly from TruCredit — track due dates, payment status, and aging automatically.",
    link: "/app/invoices/new",
    linkLabel: "New Invoice",
    condition: (s) => s.totalInvoices === 0,
  },
  {
    title: "Set Up Collection Rules",
    body: 'Configure automated collection rules with escalating tones — "Friendly" → "Firm" → "Final Notice". TruCredit sends them on schedule.',
    link: "/app/rules",
    linkLabel: "Manage Rules",
    condition: (s) => s.totalRules === 0,
  },
  {
    title: "Review Aging AR",
    body: "Check overdue invoices sorted by days past due. Prioritize 90+ day buckets first.",
    link: "/app/invoices",
    linkLabel: "View Invoices",
    condition: (s) => s.totalInvoices > 0, // only if they have invoices
  },
  {
    title: "Task Board",
    body: "Review daily collection tasks — who to call, which invoices are due, and upcoming payment milestones.",
    link: "/app/tasks",
    linkLabel: "Open Tasks",
    condition: (s) => s.activeTasks > 0,
  },
  {
    title: "Check Customer Health",
    body: "Monitor Days Sales Outstanding (DSO) and payment trends per customer. Flag accounts with rising DSO.",
    link: "/app/customers",
    linkLabel: "View Customers",
  },
  {
    title: "Email Templates",
    body: "Customize email templates TruCredit uses for payment reminders. Add your brand voice and payment instructions.",
    link: "/app/settings",
    linkLabel: "Settings",
  },
  {
    title: "Bulk Invoice Creation",
    body: "Need to invoice multiple customers at once? Use bulk create from the Invoices page to save time.",
    link: "/app/invoices/new",
    linkLabel: "New Invoice",
    condition: (s) => s.totalInvoices >= 5,
  },
];

const ROTATION_INTERVAL = 6000; // 6 seconds per tip
const DISMISS_COOKIE = "trucredit:quickTipsDismissed";

export interface QuickTipsProps {
  totalCustomers: number;
  totalInvoices: number;
  activeTasks: number;
  totalRules: number;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

export default function QuickTips(props: QuickTipsProps) {
  const { totalCustomers, totalInvoices, activeTasks, totalRules } = props;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  // P2: Data-driven filtering — prioritize tips for what user hasn't done yet
  const filteredTips = useMemo(() => {
    const applicable = TIPS.filter((tip) => {
      if (!tip.condition) return true;
      return tip.condition(props);
    });
    // Always show at least 2 tips (fallback to generic ones)
    if (applicable.length < 2) {
      const generic = TIPS.filter((t) => !t.condition);
      return [...applicable, ...generic].slice(0, Math.max(2, applicable.length + 1));
    }
    return applicable;
  }, [props]);

  // Auto-dismiss: all 4 pillars in place
  const fullySetup =
    totalCustomers > 0 && totalInvoices > 0 && activeTasks > 0 && totalRules > 0;

  useEffect(() => {
    try {
      setDismissed(getCookie(DISMISS_COOKIE) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const next = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % filteredTips.length);
  }, [filteredTips.length]);

  useEffect(() => {
    const timer = setInterval(next, ROTATION_INTERVAL);
    return () => clearInterval(timer);
  }, [next]);

  const handleDismiss = () => {
    try { setCookie(DISMISS_COOKIE, "1"); } catch { /* noop */ }
    setDismissed(true);
  };

  if (dismissed === true || fullySetup) return null;
  if (dismissed === null) return null;
  if (filteredTips.length === 0) return null;

  const tip = filteredTips[currentIndex]!;

  return (
    <Card padding="500">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center" wrap>
            <Text as="h2" variant="headingMd">
              Quick Tips
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {currentIndex + 1} / {filteredTips.length}
            </Text>
          </InlineStack>
          <Button
            variant="tertiary"
            size="micro"
            onClick={handleDismiss}
            accessibilityLabel="Dismiss quick tips"
          >
            Dismiss
          </Button>
        </InlineStack>

        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            {tip.title}
          </Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            {tip.body}
          </Text>
        </BlockStack>

        <InlineStack gap="400" blockAlign="center" wrap>
          <Link url={tip.link} monochrome>
            {tip.linkLabel} →
          </Link>
        </InlineStack>

        <Box paddingBlockStart="200">
          <InlineStack gap="100" align="center">
            {filteredTips.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentIndex(i)}
                style={{
                  width: i === currentIndex ? 24 : 8,
                  height: 8,
                  borderRadius: 4,
                  border: "none",
                  background:
                    i === currentIndex
                      ? "var(--p-color-bg-fill-brand)"
                      : "var(--p-color-bg-fill-tertiary)",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  padding: 0,
                }}
                aria-label={`Tip ${i + 1}`}
              />
            ))}
          </InlineStack>
        </Box>

        <ProgressBar
          progress={(currentIndex / (filteredTips.length - 1)) * 100}
          size="small"
          tone="primary"
        />
      </BlockStack>
    </Card>
  );
}
