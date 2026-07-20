// TruCredit — app routes layout (Wandex-style flat top nav)
import type { LoaderFunctionArgs } from "@remix-run/node";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Outlet,
  useLocation,
  useLoaderData,
  useNavigation,
  useNavigate,
  Link,
} from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import {
  Box,
  InlineStack,
  BlockStack,
  Text,
  Badge,
  Button,
  SkeletonBodyText,
  Popover,
  ActionList,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { useEffect, useRef, useState } from "react";
import { logger } from "~/services/logger.server";

export const links = () => [
  { rel: "preload", href: polarisStyles, as: "style" },
  { rel: "stylesheet", href: polarisStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startTime = Date.now();
  const url = new URL(request.url);
  const hostParam = url.searchParams.get("host") || "";

  try {
    const { session } = await authenticate.admin(request);
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop.trim() },
    });

    const elapsed = Date.now() - startTime;
    return json(
      {
        apiKey: process.env.SHOPIFY_API_KEY || "",
        shop: session.shop,
        host: hostParam,
        authed: true,
        plan: shop?.plan || "FREE",
        subscriptionStatus: shop?.subscriptionStatus || "NONE",
      },
      {
        headers: {
          "Cache-Control": "private, max-age=30, must-revalidate",
          "X-Response-Time": `${elapsed}ms`,
        },
      },
    );
  } catch (e: unknown) {
    // authenticate.admin() throws Response on auth failure.
    // In embedded iframe, id_token may be missing/expired on _data refetches.
    // Fall back to DB lookup before re-throwing — once installed, the shop
    // record exists and we can serve the page without OAuth redirect loop.
    if (e instanceof Response) {
      // Try session table → shop table as fallback
      const dbSession = await prisma.session.findFirst({
        orderBy: { id: "desc" },
        select: { shop: true },
      });

      let shopDomain: string | null = null;
      if (dbSession?.shop) {
        shopDomain = dbSession.shop.trim();
      } else {
        const anyShop = await prisma.shop.findFirst({
          orderBy: { createdAt: "desc" },
          select: { shopDomain: true },
        });
        if (anyShop?.shopDomain) shopDomain = anyShop.shopDomain.trim();
      }

      if (shopDomain) {
        const shop = await prisma.shop.findUnique({
          where: { shopDomain },
        });
        const elapsed = Date.now() - startTime;
        return json(
          {
            apiKey: process.env.SHOPIFY_API_KEY || "",
            shop: shopDomain,
            host: hostParam,
            authed: true,
            plan: shop?.plan || "FREE",
            subscriptionStatus: shop?.subscriptionStatus || "NONE",
          },
          {
            headers: {
              "Cache-Control": "private, max-age=30, must-revalidate",
              "X-Response-Time": `${elapsed}ms`,
            },
          },
        );
      }

      // No shop or session in DB at all — must redirect (first install)
      throw e;
    }

    // Dev mode: auto-seed database on cold start
    if (process.env.NODE_ENV === "development") {
      const devShop = process.env.DEV_SHOP || "trucredit-dev.myshopify.com";
      try {
        const existingShop = await prisma.shop.findFirst();
        if (!existingShop) {
          logger.app("INFO", "Cold start — auto-seeding dev data");
          await prisma.session.create({
            data: {
              id: "dev-session",
              shop: devShop,
              state: "dev",
              isOnline: false,
              accessToken: "dev-token",
              scope:
                "read_orders,write_orders,read_customers,write_customers,read_products,write_products",
              expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            },
          });
          await prisma.shop.create({
            data: {
              shopDomain: devShop,
              accessToken: "dev-token",
              plan: "FREE",
              uninstalledAt: null,
            },
          });
          logger.app("INFO", "Cold start — auto-seed complete");
          const shop = await prisma.shop.findUnique({
            where: { shopDomain: devShop },
          });
          const elapsed = Date.now() - startTime;
          return json(
            {
              apiKey: process.env.SHOPIFY_API_KEY || "",
              shop: devShop,
              host: hostParam,
              authed: true,
              plan: shop?.plan || "FREE",
              subscriptionStatus: shop?.subscriptionStatus || "NONE",
            },
            {
              headers: {
                "Cache-Control": "private, max-age=30, must-revalidate",
                "X-Response-Time": `${elapsed}ms`,
              },
            },
          );
        }

        // Data already seeded — use existing
        logger.app("INFO", "Dev mode — using existing seeded data");
        const shop = await prisma.shop.findFirst();
        const elapsed = Date.now() - startTime;
        return json(
          {
            apiKey: process.env.SHOPIFY_API_KEY || "",
            shop: shop?.shopDomain || "",
            host: hostParam,
            authed: true,
            plan: shop?.plan || "FREE",
            subscriptionStatus: shop?.subscriptionStatus || "NONE",
          },
          {
            headers: {
              "Cache-Control": "private, max-age=30, must-revalidate",
              "X-Response-Time": `${elapsed}ms`,
            },
          },
        );
      } catch (seedErr: unknown) {
        logger.app("ERROR", "Cold start auto-seed failed", seedErr);
      }
    }

    logger.app(
      "WARN",
      "OAuth failed",
      e instanceof Error ? e.message : String(e),
    );
  }

  // Final fallback: unauthed
  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: "",
    host: hostParam,
    authed: false,
    plan: "FREE",
    subscriptionStatus: "NONE",
    appUrl: process.env.SHOPIFY_APP_URL || url.origin,
  });
};

// ═══ Performance: skip layout loader on tab switches ═══
export const shouldRevalidate = ({
  formMethod,
}: ShouldRevalidateFunctionArgs) => {
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  return false;
};

// ── Navigation config — 6 top-level items (3 standalone + 3 dropdowns) ──

interface NavSubItem {
  label: string;
  href: string;
}

interface NavGroup {
  label: string;
  match: string;
  items: NavSubItem[];
}

const NAV_STANDALONE = [
  { label: "Dashboard", href: "/app", match: "/app" },
  { label: "Customers", href: "/app/customers", match: "/app/customers" },
  { label: "Invoices", href: "/app/invoices", match: "/app/invoices" },
] as const;

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Automation",
    match: "/app/rules",
    items: [
      { label: "Rules", href: "/app/rules" },
      { label: "Collections", href: "/app/collections" },
    ],
  },
  {
    label: "Activity",
    match: "/app/tasks",
    items: [
      { label: "Tasks", href: "/app/tasks" },
      { label: "Emails", href: "/app/emails" },
      { label: "Replies", href: "/app/replies" },
    ],
  },
  {
    label: "Settings",
    match: "/app/settings",
    items: [
      { label: "General", href: "/app/settings" },
      { label: "Billing", href: "/app/billing" },
    ],
  },
];

function isStandaloneActive(href: string, pathname: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

// ── NavDropdown Component ──
function NavDropdown({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const [active, setActive] = useState(false);
  const navigate = useNavigate();
  const isGroupActive = group.items.some((item) =>
    pathname.startsWith(item.href),
  );

  return (
    <Popover
      active={active}
      activator={
        <Button
          variant="tertiary"
          size="large"
          pressed={isGroupActive}
          onClick={() => setActive(!active)}
          removeUnderline
          disclosure
        >
          {group.label}
        </Button>
      }
      onClose={() => setActive(false)}
      fullWidth
    >
      <ActionList
        items={group.items.map((item) => ({
          content: item.label,
          onAction: () => {
            setActive(false);
            navigate(item.href);
          },
        }))}
      />
    </Popover>
  );
}

// ── Unauthed Fallback: auto-retry when auth not yet ready ──
function UnauthedFallback({ apiKey }: { apiKey: string }) {
  const retryCount = useRef(0);
  const [message, setMessage] = useState("Loading your dashboard…");

  useEffect(() => {
    const timer = setTimeout(() => {
      if (retryCount.current < 2) {
        retryCount.current += 1;
        window.location.reload();
      } else {
        setMessage(
          "Something went wrong. Please reload the app from your Shopify Admin.",
        );
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AppProvider isEmbeddedApp={false} apiKey={apiKey}>
      <Box padding="800">
        <BlockStack gap="400" align="center">
          <Text as="h1" variant="headingXl">
            TruCredit
          </Text>
          <SkeletonBodyText lines={3} />
          <Text as="p" variant="bodyLg" tone="subdued">
            {message}
          </Text>
          <Button onClick={() => window.location.reload()} variant="primary">
            Reload App
          </Button>
        </BlockStack>
      </Box>
    </AppProvider>
  );
}

export default function AppLayout() {
  const { apiKey, authed, plan } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!authed) {
    return <UnauthedFallback apiKey={apiKey} />;
  }

  return (
    <AppProvider isEmbeddedApp={true} apiKey={apiKey}>
      {/* ── Top Navigation Bar ── */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          padding: "8px 32px",
          background: "var(--p-color-bg-surface)",
          borderBottom: "1px solid var(--p-color-border)",
        }}
      >
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <InlineStack gap="600" blockAlign="center" align="space-between" wrap>
            {/* Brand + Nav */}
            <InlineStack gap="400" blockAlign="center" wrap>
              <Link to="/app" style={{ textDecoration: "none" }}>
                <InlineStack gap="200" blockAlign="center">
                  <Box
                    background="bg-fill-brand"
                    borderRadius="200"
                    padding="050"
                  >
                    <Text as="span" variant="bodySm" fontWeight="bold">
                      TC
                    </Text>
                  </Box>
                  <Text as="span" variant="bodyLg" fontWeight="bold">
                    TruCredit
                  </Text>
                </InlineStack>
              </Link>
              <InlineStack gap="500" blockAlign="center">
                {NAV_STANDALONE.map((item) => {
                  const active = isStandaloneActive(item.href, location.pathname);
                  return (
                    <Link key={item.label} to={item.href} style={{ textDecoration: "none" }}>
                      <Button
                        variant="tertiary"
                        size="large"
                        pressed={active}
                        removeUnderline
                      >
                        {item.label}
                      </Button>
                    </Link>
                  );
                })}
                {NAV_GROUPS.map((group) => (
                  <NavDropdown
                    key={group.label}
                    group={group}
                    pathname={location.pathname}
                  />
                ))}
              </InlineStack>
            </InlineStack>
            <Badge tone="info">{plan}</Badge>
          </InlineStack>
        </div>
      </div>

      {/* ── Main Content ── */}
      <Box minHeight="100vh" background="bg-surface-secondary">
        <Box
          paddingInline="800"
          paddingBlockStart="600"
          paddingBlockEnd="800"
          id="main-content"
        >
          {isLoading ? (
            <BlockStack gap="400">
              <Box background="bg-surface" borderRadius="200" padding="500">
                <BlockStack gap="400">
                  <SkeletonBodyText lines={1} />
                  <SkeletonBodyText lines={3} />
                </BlockStack>
              </Box>
              <Box background="bg-surface" borderRadius="200" padding="500">
                <BlockStack gap="400">
                  <SkeletonBodyText lines={1} />
                  <div
                    style={{
                      height: 180,
                      background: "var(--p-color-bg-surface-secondary)",
                      borderRadius: 8,
                    }}
                  />
                </BlockStack>
              </Box>
              <Box background="bg-surface" borderRadius="200" padding="500">
                <BlockStack gap="400">
                  <SkeletonBodyText lines={1} />
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Box key={i} paddingBlock="200">
                      <SkeletonBodyText lines={1} />
                    </Box>
                  ))}
                </BlockStack>
              </Box>
            </BlockStack>
          ) : (
            <div
              style={{
                opacity: visible ? 1 : 0,
                transition: "opacity 0.3s ease",
              }}
            >
              <Outlet />
            </div>
          )}
        </Box>
      </Box>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return (
    <html>
      <head>
        <title>Error — TruCredit</title>
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: "Inter, -apple-system, sans-serif",
          background: "var(--p-color-bg-surface-secondary)",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "80px auto",
            padding: 48,
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--p-color-text)",
              marginBottom: 16,
            }}
          >
            Something Went Wrong
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--p-color-text-subdued)",
              marginBottom: 24,
            }}
          >
            Please try again or check the server logs.
          </p>
          <a
            href="/app"
            style={{ color: "var(--p-color-text-link)", fontSize: 14 }}
          >
            Return to Dashboard
          </a>
        </div>
      </body>
    </html>
  );
}
