/**
 * Rate Limiter — Redis sliding window with in-memory fallback.
 *
 * Shared across API endpoints to prevent brute-force / enumeration.
 * Default: 100 requests per minute per key (configurable via RATE_LIMIT_RPM).
 *
 * For API endpoints, the key is derived from client IP (x-forwarded-for).
 * For internal use, any unique string key works.
 *
 * Fallback strategy:
 * - Redis available → atomic sliding window (ZSET)
 * - Redis unavailable → in-memory Map (per-process)
 *
 * In-memory fallback is NOT suitable for multi-instance deployments but
 * provides basic protection rather than fail-open.
 */

import redis from "~/lib/redis.server";
import { logger } from "~/services/logger.server";

const RATE_LIMIT_RPM = Number(process.env.RATE_LIMIT_RPM) || 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

// In-memory store as Redis fallback
const memoryStore = new Map<string, { count: number; resetAt: number }>();

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (now > entry.resetAt) memoryStore.delete(key);
  }
}, 60_000);

/**
 * Extract a rate-limit key from the request.
 * Uses x-forwarded-for (first IP) or falls back to a constant.
 */
export function getRateLimitKey(request: Request, route: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `api:${route}:${ip}`;
}

/** Check if a request should be rate-limited. */
export async function checkRateLimit(key: string): Promise<boolean> {
  if (redis.status === "ready") {
    return redisSlidingWindow(key);
  }
  return memorySlidingWindow(key);
}

/** Redis sliding window using sorted set. */
async function redisSlidingWindow(key: string): Promise<boolean> {
  const rk = `ratelimit:${key}`;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  try {
    // Clean expired entries, then count remaining
    await redis.zremrangebyscore(rk, 0, windowStart);
    const count = await redis.zcard(rk);

    if (count >= RATE_LIMIT_RPM) {
      logger.app("WARN", "Rate limit exceeded (redis)", undefined, {
        key,
        count,
        limit: RATE_LIMIT_RPM,
      });
      return false;
    }

    // Add current request + set TTL in a pipeline
    await redis
      .multi()
      .zadd(rk, now, `${now}-${Math.random().toString(36).slice(2, 6)}`)
      .expire(rk, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 1)
      .exec();

    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Redis rate limit failed, fallback to memory", msg);
    return memorySlidingWindow(key);
  }
}

/** In-memory fallback — simple counter with window reset. */
function memorySlidingWindow(key: string): boolean {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;

  if (entry.count > RATE_LIMIT_RPM) {
    logger.app("WARN", "Rate limit exceeded (memory)", undefined, {
      key,
      count: entry.count,
      limit: RATE_LIMIT_RPM,
    });
    return false;
  }

  return true;
}
