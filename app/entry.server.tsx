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
      .findFirst()
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
