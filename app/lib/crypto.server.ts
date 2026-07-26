// Token encryption at rest
// Uses AES-256-GCM with key derived from SHOPIFY_API_SECRET.
// Plaintext tokens (e.g., "dev-token") pass through unchanged for backward compat.

import crypto from "crypto";
import { logger } from "~/services/logger.server";

const ALGORITHM = "aes-256-gcm";
const SALT = "trucredit-2026";

function getKey(): Buffer {
  const secret = process.env.SHOPIFY_API_SECRET || Buffer.from("trucredit-placeholder-2026").toString("hex");
  return crypto.scryptSync(secret, SALT, 32);
}

/** Encrypt a plaintext access token for storage in DB. */
export function encryptToken(plain: string): string {
  if (!plain) return "";
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plain, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/** Decrypt a stored access token. Falls back to plaintext for unencrypted tokens. */
export function decryptToken(encrypted: string): string {
  if (!encrypted) return "";
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    // Not encrypted — plaintext fallback (e.g., "dev-token")
    return encrypted;
  }
  try {
    const key = getKey();
    const [ivHex, authTagHex, ciphertext] = parts as [string, string, string];
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Token decryption failed — falling back to raw value", msg);
    return encrypted;
  }
}
