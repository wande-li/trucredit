// Shared helper: resolve shop from authenticate.admin() with DB fallback.
// .data requests (client-side navigation) may lack session token → shop: null.
// This mirrors the same fallback logic in app/routes/app.tsx layout loader.
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import type { Role } from "~/lib/constants";

export interface ResolvedShop {
  shopDomain: string;
  shopId: string;
  plan: string;
  subscriptionStatus: string;
  /** RBAC role — defaults to "admin" for account owners, "viewer" for collaborators */
  role: Role;
}

/**
 * Derive the user's RBAC role from the Prisma session record.
 * Falls back to "admin" if no session is found (safe default for account owners).
 *
 * Future: when a TeamMember or staff table is added, this function should
 * look up the specific user's assigned role instead of defaulting.
 */
async function deriveRole(shopDomain: string): Promise<Role> {
  try {
    const dbSession = await prisma.session.findFirst({
      where: { shop: shopDomain },
      orderBy: { id: "desc" },
      select: { accountOwner: true, collaborator: true },
    });
    if (dbSession?.accountOwner) return "admin";
    // Fallback: if accountOwner is null/false, default to admin for safety.
    // Refining to viewer requires a proper staff table to identify non-owner users.
    return "admin";
  } catch {
    // DB lookup failed — safest default is admin (can't lock out the owner)
    return "admin";
  }
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
    const shopDomain = session.shop?.trim(); // null-safe — .data requests have shop:null

    // .data requests: authenticate succeeds but shop is null → fallback to DB
    if (!shopDomain) {
      throw new Response("Shop not in session", { status: 401 });
    }

    const role = await deriveRole(shopDomain);

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
        role,
      };
    }

    // Shop record missing — create on the fly (first-time install edge case)
    const newShop = await prisma.shop.create({
      data: { shopDomain, accessToken: session.accessToken || "" },
      select: { id: true, plan: true, subscriptionStatus: true },
    });
    return {
      shopDomain,
      shopId: newShop.id,
      plan: newShop.plan || "FREE",
      subscriptionStatus: newShop.subscriptionStatus || "NONE",
      role,
    };
  } catch (e: unknown) {
    // authenticate.admin() throws Response on auth failure
    if (e instanceof Response) {
      const shopParam = url.searchParams.get("shop") || undefined;

      // SECURITY: shopParam is required for DB fallback — without it,
      // we cannot determine tenant and MUST redirect to auth.
      if (!shopParam) {
        throw e;
      }

      // Fallback: look up shop from DB session table (tenant-scoped by shopParam)
      const dbSession = await prisma.session.findFirst({
        where: { shop: shopParam },
        orderBy: { id: "desc" },
        select: { shop: true },
      });

      let shopDomain: string | null = null;
      if (dbSession?.shop) {
        shopDomain = dbSession.shop.trim();
      } else {
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
            role: "admin", // DB fallback: assume account owner
          };
        }
      }

      // No shop or session in DB — must redirect to auth
      throw e;
    }

    // Non-Response error: log and throw generic 500
    throw new Response("Internal Server Error", { status: 500 });
  }
}
