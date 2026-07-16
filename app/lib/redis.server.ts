// TruCredit — Redis Client (single connection shared across app)
import Redis from "ioredis";

export const REDIS_PREFIX = "trucredit:" as const;

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

function createRedis(): Redis {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
  });

  redis.on("error", (err: Error) => {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "WARN",
        service: "Redis",
        message: "Redis connection error",
        error: err.message,
      }),
    );
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
  taskLock: (taskId: string) => `${REDIS_PREFIX}lock:task:${taskId}`,
  creditCache: (customerId: string) => `${REDIS_PREFIX}credit:${customerId}`,
  dashboardCache: (shopId: string) => `${REDIS_PREFIX}dashboard:${shopId}`,
  syncLock: (shop: string) => `${REDIS_PREFIX}sync:lock:${shop}`,
} as const;
