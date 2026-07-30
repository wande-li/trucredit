/**
 * bootstrap.server.ts — Server startup orchestration
 *
 * Responsibilities:
 *  1. Dev environment auto-seed (session + shop)
 *  2. Cron scheduling (daily sweep + freeze check every 30 min)
 *  3. BullMQ worker startup (collection + email)
 *  4. Graceful shutdown registration (SIGTERM / SIGINT)
 *
 * Kept separate from entry.server.tsx to keep the SSR entrypoint lean.
 */

import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

// ── Worker Registry (shared via module scope) ──
type BullMQWorker = { close: (force?: boolean) => Promise<void> };
const workerRegistry = new Map<
  string,
  BullMQWorker | Record<string, BullMQWorker | null> | null
>();

function registerWorker(name: string, worker: BullMQWorker) {
  workerRegistry.set(name, worker);
}

function registerWorkerGroup(
  name: string,
  group: Record<string, BullMQWorker> | null,
) {
  workerRegistry.set(name, group);
}

async function gracefulShutdown(signal: string) {
  logger.app("INFO", `Received ${signal}, shutting down workers...`, undefined, {
    component: "Shutdown",
    workerCount: String(workerRegistry.size),
  });

  const shutdowns: Promise<void>[] = [];

  for (const [name, entry] of workerRegistry) {
    if (!entry) continue;
    if (typeof (entry as BullMQWorker).close === "function") {
      shutdowns.push(
        (entry as BullMQWorker).close().catch((e: unknown) => {
          logger.app("ERROR", `Failed to close worker: ${name}`, e, {
            component: "Shutdown",
          });
        }),
      );
    } else {
      // Worker group object
      for (const [subName, subWorker] of Object.entries(
        entry as Record<string, BullMQWorker | null>,
      )) {
        if (subWorker && typeof subWorker.close === "function") {
          shutdowns.push(
            subWorker.close().catch((e: unknown) => {
              logger.app(
                "ERROR",
                `Failed to close worker: ${name}/${subName}`,
                e,
                { component: "Shutdown" },
              );
            }),
          );
        }
      }
    }
  }

  if (shutdowns.length === 0) {
    logger.app("INFO", "No workers to shut down", undefined, {
      component: "Shutdown",
    });
    process.exit(0);
  }

  try {
    await Promise.race([
      Promise.all(shutdowns),
      new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
    ]);
    logger.app("INFO", "All workers closed", undefined, {
      component: "Shutdown",
    });
  } catch {
    logger.app("WARN", "Worker shutdown timed out, forcing exit", undefined, {
      component: "Shutdown",
    });
  }

  process.exit(0);
}

// ── 1. Dev Auto-Seed ──
function startDevSeed() {
  if (process.env.NODE_ENV !== "development") return;

  const devShop = process.env.DEV_SHOP || "trucredit-dev.myshopify.com";
  import("~/db.server")
    .then(({ default: prisma }) => {
      logger.app("INFO", "Auto-seeding dev data (if needed)", undefined, {
        component: "Startup",
      });
      Promise.all([
        prisma.session.upsert({
          where: { id: "dev-session" },
          create: {
            id: "dev-session",
            shop: devShop,
            state: "dev",
            isOnline: false,
            accessToken: process.env.SEED_ACCESS_TOKEN || "dev-token",
            scope:
              "read_orders,write_orders,read_customers,write_customers",
            expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            accountOwner: true,
          },
          update: { accountOwner: true },
        }),
        prisma.shop.upsert({
          where: { shopDomain: devShop },
          create: {
            shopDomain: devShop,
            accessToken: process.env.SEED_ACCESS_TOKEN || "dev-token",
            plan: "FREE",
          },
          update: {
            accessToken: process.env.SEED_ACCESS_TOKEN || "dev-token",
          },
        }),
      ])
        .then(() => {
          logger.app("INFO", "Dev data ready", undefined, {
            component: "Startup",
          });
        })
        .catch((e: unknown) => {
          logger.app("ERROR", "Auto-seed failed", e, {
            component: "Startup",
          });
        });
    })
    .catch((e: unknown) => {
      logger.app("ERROR", "Failed to import db.server for seed", e, {
        component: "Startup",
      });
    });
}

// ── 2 & 3. Cron + Workers ──
function startBackgroundServices() {
  // Portal token cleanup every hour
  setInterval(() => {
    cleanExpiredTokens().catch(() => {});
  }, 60 * 60 * 1000);

  // Fire-and-forget: start background services without blocking SSR
  setTimeout(() => {
    import("~/queues/collection.queue")
      .then(async ({ enqueueSweep, enqueueFreezeCheck }) => {
        try {
          const cron = (await import("node-cron")).default;
          // Daily collection sweep at 9 AM
          cron.schedule("0 9 * * *", async () => {
            await enqueueSweep();
          });
          // Credit freeze check — every 30 minutes
          cron.schedule("*/30 * * * *", async () => {
            await enqueueFreezeCheck();
          });
        } catch {
          // node-cron optional — background jobs handled by manual trigger
        }

        import("~/workers/collection.worker")
          .then((m) => m.startCollectionWorkers())
          .then((collectionWorkers) => {
            registerWorkerGroup("collection", collectionWorkers);
          })
          .catch((e: unknown) => {
            logger.app("ERROR", "Collection worker failed to start", e, {
              component: "Startup",
            });
          });
        import("~/workers/email.worker")
          .then((m) => m.createEmailWorker())
          .then((emailWorker) => {
            registerWorker("email", emailWorker);
          })
          .catch((e: unknown) => {
            logger.app("ERROR", "Email worker failed to start", e, {
              component: "Startup",
            });
          });
      })
      .catch((e: unknown) => {
        logger.app("ERROR", "Collection queue import failed", e, {
          component: "Startup",
        });
      });
  }, 1000);
}

// ── 4. Register Shutdown Handlers ──
function registerShutdownHandlers() {
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

// ── 5. Portal Token Cleanup ──
async function cleanExpiredTokens() {
  try {
    const result = await prisma.portalToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      logger.app("INFO", "Cron: cleaned expired portal tokens", null, { count: result.count });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Cron: portal token cleanup failed", msg);
  }
}

// ── Public Bootstrap ──
export function bootstrap() {
  startDevSeed();
  startBackgroundServices();
  registerShutdownHandlers();
}
