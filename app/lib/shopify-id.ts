// TruCredit — Shopify ID normalization utility
// Shopify REST API returns numeric IDs (e.g. "123456789")
// Shopify GraphQL API returns GID format (e.g. "gid://shopify/Customer/123456789")
// This module ensures consistent handling regardless of source.

export type GidResource = "Customer" | "Order" | "DraftOrder" | "Company";

/**
 * Normalize a Shopify ID to GID format.
 * If the ID is already in GID format, return it as-is (prevents double-wrapping).
 * Otherwise, wrap it in the standard GID prefix.
 */
export function toGid(id: string | number, resource: GidResource): string {
  const raw = String(id);
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/${resource}/${raw}`;
}

/**
 * Extract the numeric portion from a GID string.
 * "gid://shopify/Customer/123456789" → "123456789"
 * "123456789" → "123456789"
 */
export function fromGid(gid: string): string {
  if (!gid.startsWith("gid://")) return gid;
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? gid;
}
