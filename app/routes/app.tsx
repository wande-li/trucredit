// TruCredit — app routes layout
// This layout wraps all /app/* pages with Polaris Frame + Nav
import type { LoaderFunctionArgs } from "@remix-run/node";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Outlet,
  useLocation,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Navigation,
  Frame,
  SkeletonBodyText,
  Box,
  BlockStack,
  Text,
  Button,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { AppProvider } from "@shopify/shopify-app-remix/react";
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
      const devShop = process.env.DEV_SHOP || "ai-pilot-dev.myshopify.com";
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
          <Button onClick={() => window.location.reload()}>
            Reload App
          </Button>
        </BlockStack>
      </Box>
    </AppProvider>
  );
}

export default function AppLayout() {
  const { apiKey, authed } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  if (!authed) {
    return <UnauthedFallback apiKey={apiKey} />;
  }

  return (
    <AppProvider isEmbeddedApp={true} apiKey={apiKey}>
      <Frame>
        <Navigation location={location.pathname}>
          <Navigation.Section
            items={[
              {
                url: "/app",
                label: "Dashboard",
                exactMatch: true,
              },
              {
                url: "/app/customers",
                label: "Customers",
                matchPaths: ["/app/customers"],
              },
              {
                url: "/app/invoices",
                label: "Invoices",
                matchPaths: ["/app/invoices"],
              },
              {
                url: "/app/rules",
                label: "Rules",
                matchPaths: ["/app/rules"],
              },
              {
                url: "/app/collections",
                label: "Collections",
                matchPaths: ["/app/collections"],
              },
              {
                url: "/app/tasks",
                label: "Tasks",
                matchPaths: ["/app/tasks"],
              },
              {
                url: "/app/emails",
                label: "Emails",
                matchPaths: ["/app/emails"],
              },
              {
                url: "/app/replies",
                label: "Replies",
                matchPaths: ["/app/replies"],
              },
              {
                url: "/app/billing",
                label: "Billing",
                matchPaths: ["/app/billing"],
              },
            ]}
          />
        </Navigation>
        {isLoading ? (
          <Box padding="600">
            <SkeletonBodyText lines={8} />
          </Box>
        ) : (
          <Outlet />
        )}
      </Frame>
    </AppProvider>
  );
}
