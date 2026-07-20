import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import {
  createReadableStreamFromReadable,
  type EntryContext,
} from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import {
  withRequestContext,
  setRequestContext,
  logger,
} from "~/services/logger.server";

// Dev cold-start: auto-seed session + shop if DB is empty.
// Without this, authenticate.admin() has no session to validate and the
// app shows a blank UnauthedFallback instead of the OAuth login flow.
if (process.env.NODE_ENV === "development") {
  const devShop = process.env.DEV_SHOP || "trucredit-dev.myshopify.com";
  import("~/db.server").then(({ default: prisma }) => {
    prisma.session
      .findFirst({ where: { shop: devShop } })
      .then((s) => {
        if (!s) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "INFO",
              service: "Startup",
              message: "Cold start — auto-seeding dev data",
            }),
          );
          return Promise.all([
            prisma.session.create({
              data: {
                id: "dev-session",
                shop: devShop,
                state: "dev",
                isOnline: false,
                accessToken: "dev-token",
                scope:
                  "read_orders,write_orders,read_customers,write_customers",
                expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
              },
            }),
            prisma.shop.upsert({
              where: { shopDomain: devShop },
              create: {
                shopDomain: devShop,
                accessToken: "dev-token",
                plan: "FREE",
              },
              update: { accessToken: "dev-token" },
            }),
          ]);
        }
      })
      .then(() => {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "INFO",
            service: "Startup",
            message: "Dev data ready",
          }),
        );
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "ERROR",
            service: "Startup",
            message: "Auto-seed failed",
            error: (e as Error)?.message ?? String(e),
          }),
        );
      });
  });
}

export const streamTimeout = 5000;

// Fire-and-forget: start background services without blocking SSR
setTimeout(() => {
  import("~/queues/collection.queue").then(async ({ enqueueSweep }) => {
    try {
      const cron = (await import("node-cron")).default;
      cron.schedule("0 9 * * *", async () => {
        await enqueueSweep();
      });
    } catch {
      // node-cron optional — background sweep will be handled by manual trigger
    }

    import("~/workers/collection.worker")
      .then((m) => m.startCollectionWorkers())
      .then((collectionWorkers) => {
        registerWorkerGroup("collection", collectionWorkers);
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "ERROR",
            service: "Startup",
            message: "Collection worker failed to start",
            error: (e as Error)?.message ?? String(e),
          }),
        );
      });
    import("~/workers/email.worker")
      .then((m) => m.createEmailWorker())
      .then((emailWorker) => {
        registerWorker("email", emailWorker);
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "ERROR",
            service: "Startup",
            message: "Email worker failed to start",
            error: (e as Error)?.message ?? String(e),
          }),
        );
      });
  }).catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        service: "Startup",
        message: "Collection queue import failed",
        error: (e as Error)?.message ?? String(e),
      }),
    );
  });
}, 1000);

// ── Graceful Shutdown ──
type BullMQWorker = { close: (force?: boolean) => Promise<void> };
const workerRegistry = new Map<string, BullMQWorker | Record<string, BullMQWorker | null> | null>();

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
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      service: "Shutdown",
      message: `Received ${signal}, shutting down workers...`,
      workerCount: workerRegistry.size,
    }),
  );

  const shutdowns: Promise<void>[] = [];

  for (const [name, entry] of workerRegistry) {
    if (!entry) continue;
    if (typeof (entry as BullMQWorker).close === "function") {
      shutdowns.push(
        (entry as BullMQWorker).close().catch((e) => {
          // eslint-disable-next-line no-console
          console.error(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "ERROR",
              service: "Shutdown",
              message: `Failed to close worker: ${name}`,
              error: (e as Error)?.message ?? String(e),
            }),
          );
        }),
      );
    } else {
      // Worker group object
      for (const [subName, subWorker] of Object.entries(
        entry as Record<string, BullMQWorker | null>,
      )) {
        if (subWorker && typeof subWorker.close === "function") {
          shutdowns.push(
            subWorker.close().catch((e) => {
              // eslint-disable-next-line no-console
              console.error(
                JSON.stringify({
                  timestamp: new Date().toISOString(),
                  level: "ERROR",
                  service: "Shutdown",
                  message: `Failed to close worker: ${name}/${subName}`,
                  error: (e as Error)?.message ?? String(e),
                }),
              );
            }),
          );
        }
      }
    }
  }

  if (shutdowns.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        service: "Shutdown",
        message: "No workers to shut down",
      }),
    );
    process.exit(0);
  }

  try {
    await Promise.race([
      Promise.all(shutdowns),
      new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
    ]);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        service: "Shutdown",
        message: "All workers closed",
      }),
    );
  } catch {
    // Timeout — force exit
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "WARN",
        service: "Shutdown",
        message: "Worker shutdown timed out, forcing exit",
      }),
    );
  }

  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  const startTime = Date.now();
  const url = new URL(request.url);
  const requestId =
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6);

  const pathname = url.pathname;
  const shouldLog = !pathname.startsWith("/build/") && !pathname.startsWith("/assets/");

  return withRequestContext(
    { requestId, path: pathname, method: request.method },
    () => {
      // Log request start
      if (shouldLog) {
        logger.request("INFO", `→ ${request.method} ${pathname}`);
      }

      addDocumentResponseHeaders(request, responseHeaders);
      const userAgent = request.headers.get("user-agent");
      const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

      return new Promise((resolve, reject) => {
        const { pipe, abort } = renderToPipeableStream(
          <RemixServer context={remixContext} url={request.url} />,
          {
            [callbackName]: () => {
              const body = new PassThrough();
              const stream = createReadableStreamFromReadable(body);

              responseHeaders.set("Content-Type", "text/html");

              // Extract shop from session header if available
              const shop = responseHeaders.get("x-shopify-shop-domain");
              if (shop) setRequestContext({ shop });

              const duration = Date.now() - startTime;
              if (shouldLog) {
                logger.request(
                  "INFO",
                  `← ${responseStatusCode} ${pathname}`,
                  duration,
                );
              }

              resolve(
                new Response(stream, {
                  headers: responseHeaders,
                  status: responseStatusCode,
                }),
              );
              pipe(body);
            },
            onShellError(error) {
              const duration = Date.now() - startTime;
              if (shouldLog) {
                logger.request(
                  "ERROR",
                  `SSR shell error ${pathname}`,
                  duration,
                  { error: (error as Error)?.message },
                );
              }
              reject(error);
            },
            onError(_error) {
              responseStatusCode = 500;
            },
          },
        );

        setTimeout(abort, streamTimeout + 1000);
      });
    },
  );
}
