// Shared helper: resolve shop from authenticate.admin() with DB fallback.
// .data requests (client-side navigation) may lack session token → shop: null.
// This mirrors the same fallback logic in app/routes/app.tsx layout loader.
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export interface ResolvedShop {
  shopDomain: string;
  shopId: string;
  plan: string;
  subscriptionStatus: string;
}

/**
 * Try authenticate.admin() first, fall back to DB session/shop lookup.
 * Throws Response (redirect to auth) only if no shop can be found at all.
 */
export async function resolveShop(request: Request): Promise<ResolvedShop> {
  const url = new URL(request.url);

  // Primary path: normal Shopify session auth
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true, subscriptionStatus: true },
    });

    if (shop) {
      return {
        shopDomain,
        shopId: shop.id,
        plan: shop.plan || "FREE",
        subscriptionStatus: shop.subscriptionStatus || "NONE",
      };
    }

    // Shop record missing — create on the fly (first-time install edge case)
    const newShop = await prisma.shop.create({
      data: { shopDomain: session.shop.trim(), accessToken: session.accessToken || "" },
      select: { id: true, plan: true, subscriptionStatus: true },
    });
    return {
      shopDomain,
      shopId: newShop.id,
      plan: newShop.plan || "FREE",
      subscriptionStatus: newShop.subscriptionStatus || "NONE",
    };
  } catch (e: unknown) {
    // authenticate.admin() throws Response on auth failure
    if (e instanceof Response) {
      // Fallback: look up shop from DB session table
      const shopParam = url.searchParams.get("shop") || undefined;

      const dbSession = await prisma.session.findFirst({
        where: shopParam ? { shop: shopParam } : undefined,
        orderBy: { id: "desc" },
        select: { shop: true },
      });

      let shopDomain: string | null = null;
      if (dbSession?.shop) {
        shopDomain = dbSession.shop.trim();
      } else if (shopParam) {
        const anyShop = await prisma.shop.findFirst({
          where: { shopDomain: shopParam },
          select: { shopDomain: true },
        });
        if (anyShop?.shopDomain) shopDomain = anyShop.shopDomain.trim();
      }

      if (shopDomain) {
        const shop = await prisma.shop.findUnique({
          where: { shopDomain },
          select: { id: true, plan: true, subscriptionStatus: true },
        });

        if (shop) {
          return {
            shopDomain,
            shopId: shop.id,
            plan: shop.plan || "FREE",
            subscriptionStatus: shop.subscriptionStatus || "NONE",
          };
        }
      }

      // No shop or session in DB at all — must redirect to auth
      throw e;
    }

    // Non-Response error: log and throw generic 500
    throw new Response("Internal Server Error", { status: 500 });
  }
}
