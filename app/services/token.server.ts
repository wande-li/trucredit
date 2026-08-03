// Token Service — Secure payment/portal token generation and validation
// Uses AES-256-GCM (reuses crypto.server.ts encryptToken/decryptToken)
// Token payload includes shopId, customerId, scope, resourceId, expiresAt
// Tokens expire after 7 days; scope-bound to prevent cross-resource misuse
// Portal tokens are persisted to DB so they can be revoked server-side

import { createHash } from "crypto";
import { encryptToken, decryptToken } from "~/lib/crypto.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

export type TokenScope = "invoice_pay" | "portal" | "statement";

export interface TokenPayload {
  shopId: string;
  customerId: string;
  scope: TokenScope;
  resourceId: string; // invoiceId for invoice_pay, customerId for portal, etc.
  exp: number; // Unix timestamp (seconds)
}

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a secure token for buyer-facing pages.
 * Token is encrypted, not just signed — payload is invisible to the buyer.
 */
export function generateToken(payload: Omit<TokenPayload, "exp">): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const full: TokenPayload = { ...payload, exp };
  const json = JSON.stringify(full);
  return encryptToken(json);
}

/**
 * Validate and decode a buyer token.
 * Returns decoded payload or null if invalid/expired/revoked.
 */
export async function validateToken(token: string): Promise<TokenPayload | null> {
  if (!token) return null;

  let raw: string;
  try {
    raw = decryptToken(token);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "token.validate — decrypt failed", msg);
    return null;
  }

  if (!raw) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(raw) as TokenPayload;
  } catch {
    logger.app("WARN", "token.validate — payload parse failed");
    return null;
  }

  // Validate required fields
  if (!payload.shopId || !payload.customerId || !payload.scope || !payload.resourceId || !payload.exp) {
    logger.app("WARN", "token.validate — missing required fields");
    return null;
  }

  // Check expiration
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    logger.app("WARN", "token.validate — token expired", undefined, {
      scope: payload.scope,
      resourceId: payload.resourceId,
      exp: payload.exp,
    });
    return null;
  }

  // Check if token has been revoked (portal tokens only — others are stateless)
  if (payload.scope === "portal") {
    try {
      const dbToken = await prisma.portalToken.findUnique({
        where: { tokenHash: hashToken(token) },
        select: { revokedAt: true },
      });
      if (dbToken?.revokedAt) {
        logger.app("WARN", "token.validate — token revoked", undefined, {
          customerId: payload.customerId,
        });
        return null;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "token.validate — DB revocation check failed", msg);
      // Fail open: allow access if DB is unavailable
    }
  }

  return payload;
}

/**
 * Revoke a single portal token.
 * Returns false if token not found.
 */
export async function revokePortalToken(token: string): Promise<boolean> {
  try {
    const result = await prisma.portalToken.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      logger.app("INFO", "token.revoke — single token revoked");
    }
    return result.count > 0;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "token.revokePortalToken — failed", msg);
    return false;
  }
}

/**
 * Revoke all portal tokens for a customer.
 * Use when: account disabled, security concern, merchant blocks access.
 */
export async function revokeAllCustomerTokens(shopId: string, customerId: string): Promise<number> {
  try {
    const result = await prisma.portalToken.updateMany({
      where: { shopId, customerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      logger.app("INFO", "token.revokeAll — customer tokens revoked", undefined, {
        customerId,
        count: result.count,
      });
    }
    return result.count;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "token.revokeAllCustomerTokens — failed", msg);
    return 0;
  }
}

/**
 * Generate a payment link token for an invoice.
 * Usage: `https://{APP_URL}/pay/{generatePaymentToken(...)}`
 */
export function generatePaymentToken(params: {
  shopId: string;
  customerId: string;
  invoiceId: string;
}): string {
  return generateToken({
    shopId: params.shopId,
    customerId: params.customerId,
    scope: "invoice_pay",
    resourceId: params.invoiceId,
  });
}

/**
 * Build the full payment URL from a token.
 */
export function buildPaymentUrl(token: string): string {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("SHOPIFY_APP_URL environment variable is required to build payment URLs.");
  const base = appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
  return `${base}/pay/${token}`;
}

/**
 * Generate a portal access token for a customer + persist to DB for revocation support.
 * Usage: `https://{APP_URL}/portal/{generatePortalToken(...)}`
 */
export async function generatePortalToken(params: {
  shopId: string;
  customerId: string;
}): Promise<string> {
  const token = generateToken({
    shopId: params.shopId,
    customerId: params.customerId,
    scope: "portal",
    resourceId: params.customerId,
  });

  // Persist token hash in DB so it can be revoked later
  try {
    await prisma.portalToken.create({
      data: {
        shopId: params.shopId,
        customerId: params.customerId,
        tokenHash: hashToken(token),
        scope: "portal",
        expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "token.generatePortalToken — DB persist failed", msg);
    // Token still valid cryptographically, just can't be revoked server-side
  }

  return token;
}

/**
 * Try to extract token payload without expiry/revocation checks.
 * Used to provide shop context for renewal pages when the token has expired.
 */
export async function tryExtractTokenPayload(
  token: string,
): Promise<Pick<TokenPayload, "shopId" | "customerId" | "scope"> | null> {
  if (!token) return null;
  try {
    const raw = decryptToken(token);
    const payload = JSON.parse(raw) as TokenPayload;
    if (!payload.shopId || !payload.customerId || !payload.scope) return null;
    return { shopId: payload.shopId, customerId: payload.customerId, scope: payload.scope };
  } catch {
    return null;
  }
}

/**
 * Extend portal token expiry by TOKEN_TTL_SECONDS from now (sliding expiration).
 * Fails silently — only logged, never throws, so page load is never blocked.
 */
export async function extendPortalToken(token: string): Promise<void> {
  try {
    const result = await prisma.portalToken.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000) },
    });
    if (result.count > 0) {
      logger.app("INFO", "token.extendPortalToken — extended", undefined, { count: result.count });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "token.extendPortalToken — failed", msg);
  }
}

/**
 * Build the full portal URL from a token.
 */
export function buildPortalUrl(token: string): string {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("SHOPIFY_APP_URL environment variable is required to build portal URLs.");
  const base = appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
  return `${base}/portal/${token}`;
}
