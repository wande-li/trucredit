// TruCredit — Shopify GraphQL Admin API client
// Wraps the authenticated admin client from shopify-app-remix with rate-limit awareness
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import redis, { keys } from "~/lib/redis.server";
import { logger } from "~/services/logger.server";

const THROTTLE_RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;
// Buffer: pause when <5% of bucket remains
const RATE_LIMIT_BUFFER_RATIO = 0.05;

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: {
    cost: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

// Shopify admin.graphql() return type varies by framework version.
// Use a flexible type to handle both Response (raw) and parsed JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShopifyGraphQLResult = Record<string, any>;

/**
 * Execute a GraphQL query via the authenticated Shopify admin client,
 * with automatic rate-limit throttling and retry on THROTTLED errors.
 */
export async function adminGraphQL<T>(
  admin: AdminApiContext,
  shopDomain: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphQLResponse<T>> {
  return executeWithRetry<T>(
    async () => {
      const raw = await admin.graphql(query, { variables });
      return normalizeResponse<T>(raw);
    },
    shopDomain,
    0,
  );
}

/**
 * Normalize admin.graphql() response — handles both raw Response and parsed objects.
 */
function normalizeResponse<T>(raw: ShopifyGraphQLResult | Response): GraphQLResponse<T> {
  // If it's a fetch Response, parse JSON
  if (typeof (raw as Response).json === "function") {
    return raw as unknown as GraphQLResponse<T>;
  }
  // Already parsed — use as-is (shopify-app-remix returns body directly)
  const body = raw as ShopifyGraphQLResult;
  return {
    data: body.data as T | undefined,
    errors: body.errors,
    extensions: body.extensions,
  };
}

async function executeWithRetry<T>(
  fn: () => Promise<GraphQLResponse<T>>,
  shopDomain: string,
  attempt: number,
): Promise<GraphQLResponse<T>> {
  // 1. Check local rate limit buffer before executing
  await checkRateLimit(shopDomain);

  // 2. Execute
  const body = await fn();

  // 3. Update rate limit status from response
  if (body.extensions?.cost) {
    const { currentlyAvailable, restoreRate } = body.extensions.cost.throttleStatus;
    const ttl = Math.max(5, Math.ceil(1000 / restoreRate) * 2);
    await redis.setex(keys.shopifyRateLimit(shopDomain), ttl, String(currentlyAvailable));
  }

  // 4. Retry on THROTTLED
  const isThrottled = body.errors?.some(
    (e) => e.extensions?.code === "THROTTLED",
  );
  if (isThrottled && attempt < MAX_RETRIES) {
    logger.app(
      "WARN",
      `Shopify API throttled (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`,
      { shopDomain },
    );
    await new Promise((r) => setTimeout(r, THROTTLE_RETRY_DELAY_MS * (attempt + 1)));
    return executeWithRetry<T>(fn, shopDomain, attempt + 1);
  }

  return body;
}

/**
 * Wait if the rate-limit bucket is nearly empty.
 */
async function checkRateLimit(shopDomain: string): Promise<void> {
  const raw = await redis.get(keys.shopifyRateLimit(shopDomain));
  if (!raw) return;

  const available = parseInt(raw, 10);
  if (isNaN(available)) return;

  const minAvailable = Math.max(1, Math.round(1000 * RATE_LIMIT_BUFFER_RATIO));
  if (available > minAvailable) return;

  logger.app("INFO", "Shopify rate limit approaching, pausing...", {
    shopDomain,
    available,
    minAvailable,
  });
  await new Promise((r) => setTimeout(r, 1000));
}
