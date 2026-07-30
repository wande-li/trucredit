// TruCredit — Redis Client (single connection shared across app)
import Redis from "ioredis";
import { logger } from "~/services/logger.server";

export const REDIS_PREFIX = "trucredit:" as const;
export const BULLMQ_PREFIX = "b2b" as const;

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error("REDIS_URL environment variable is required. Set it in Railway or .env.");
}
export { REDIS_URL };
const url: string = REDIS_URL; // guaranteed non-null by guard above

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

function createRedis(): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: null, // Required for BullMQ (handles own retry)
    enableReadyCheck: false,    // BullMQ workers perform their own readiness check
    lazyConnect: false,
  });

  redis.on("error", (err: Error) => {
    logger.app("WARN", "redis — connection error", err.message);
  });

  return redis;
}

const redis: Redis = global.__redis ?? createRedis();

if (process.env.NODE_ENV !== "production") {
  global.__redis = redis;
}

export default redis;

// Redis Key helpers — single point of key format management
export const keys = {
  session: (shop: string) => `${REDIS_PREFIX}session:${shop}`,
  rateLimit: (shop: string) => `${REDIS_PREFIX}ratelimit:${shop}`,
  shopifyRateLimit: (shop: string) => `${REDIS_PREFIX}shopify:ratelimit:${shop}`,
  taskLock: (taskId: string) => `${REDIS_PREFIX}lock:task:${taskId}`,          // Reserved: per-task mutex
  creditCache: (customerId: string) => `${REDIS_PREFIX}credit:${customerId}`,
  dashboardCache: (shopId: string) => `${REDIS_PREFIX}dashboard:${shopId}`,
  dashboardLock: (shopId: string) => `${REDIS_PREFIX}dashboard:lock:${shopId}`,
  syncLock: (shop: string) => `${REDIS_PREFIX}sync:lock:${shop}`,              // Reserved: company sync mutex
  sweepLock: (shopId: string) => `${REDIS_PREFIX}sweep:lock:${shopId}`,
  emailRateLimit: (shopId: string, emailType: string) => `${REDIS_PREFIX}email:rate:${emailType}:${shopId}`,
} as const;
