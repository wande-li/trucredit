// TruCredit QuickTips — Contextual tips for returning users.
// Shown on Dashboard when >=1 customer exists. Dismissed via cookie or auto-hide when fully set up.
import { useState, useEffect, useCallback } from "react";
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

const TIPS = [
  {
    title: "Review Aging AR",
    body: "Check the Current tab for overdue invoices sorted by days past due. Prioritize 90+ day buckets first.",
    link: "/app/invoices",
    linkLabel: "View Invoices",
  },
  {
    title: "Automate Reminders",
    body: 'Configure collection rules with escalating tones — "Friendly" → "Firm" → "Final Notice". TruCredit sends them automatically.',
    link: "/app/rules",
    linkLabel: "Manage Rules",
  },
  {
    title: "Check Customer Health",
    body: "Monitor Days Sales Outstanding (DSO) and payment trends per customer. Flag accounts with rising DSO.",
    link: "/app/customers",
    linkLabel: "View Customers",
  },
  {
    title: "Task Board",
    body: "Review daily collection tasks — who to call, which invoices are due, and upcoming payment milestones.",
    link: "/app/tasks",
    linkLabel: "Open Tasks",
  },
  {
    title: "Customer Credit Overview",
    body: "Review all synced B2B customers, their credit grades, risk levels, and current credit usage.",
    link: "/app/customers",
    linkLabel: "View Customers",
  },
  {
    title: "Email Templates",
    body: "Customize the email templates TruCredit uses for payment reminders. Add your brand voice and payment instructions.",
    link: "/app/settings",
    linkLabel: "Settings",
  },
  {
    title: "Bulk Invoice Creation",
    body: "Need to invoice multiple customers at once? Use bulk create from the Invoices page to save time.",
    link: "/app/invoices/new",
    linkLabel: "New Invoice",
  },
];

const ROTATION_INTERVAL = 6000; // 6 seconds per tip
const DISMISS_COOKIE = "trucredit:quickTipsDismissed";

interface QuickTipsProps {
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

export default function QuickTips({
  totalCustomers,
  totalInvoices,
  activeTasks,
  totalRules,
}: QuickTipsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState<boolean | null>(null); // null = loading from cookie

  // Check if auto-dismiss conditions are met (all 4 pillars in place)
  const fullySetup = totalCustomers > 0 && totalInvoices > 0 && activeTasks > 0 && totalRules > 0;

  useEffect(() => {
    try {
      setDismissed(getCookie(DISMISS_COOKIE) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const next = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % TIPS.length);
  }, []);

  useEffect(() => {
    const timer = setInterval(next, ROTATION_INTERVAL);
    return () => clearInterval(timer);
  }, [next]);

  const handleDismiss = () => {
    try { setCookie(DISMISS_COOKIE, "1"); } catch { /* noop */ }
    setDismissed(true);
  };

  // Hidden: user explicitly dismissed OR auto-dismiss when fully set up
  if (dismissed === true || fullySetup) return null;
  // Still loading cookie — don't flash
  if (dismissed === null) return null;

  const tip = TIPS[currentIndex]!;

  return (
    <Card padding="500">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center" wrap>
            <Text as="h2" variant="headingMd">
              Quick Tips
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {currentIndex + 1} / {TIPS.length}
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

        {/* Dot indicators */}
        <Box paddingBlockStart="200">
          <InlineStack gap="100" align="center">
            {TIPS.map((_, i) => (
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
          progress={(currentIndex / (TIPS.length - 1)) * 100}
          size="small"
          tone="primary"
        />
      </BlockStack>
    </Card>
  );
}
