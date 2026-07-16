import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import {
  createReadableStreamFromReadable,
  type EntryContext,
} from "@remix-run/node";
import { isbot } from "isbot";
import cron from "node-cron";
import { addDocumentResponseHeaders } from "./shopify.server";
import { withRequestContext, logger } from "~/services/logger.server";
import { enqueueSweep } from "~/queues/collection.queue";

export const streamTimeout = 5000;

// Start collection workers once (not per-request)
let _workersStarted = false;
async function ensureWorkers() {
  if (_workersStarted) return;
  _workersStarted = true;

  try {
    const { startCollectionWorkers } = await import("~/workers/collection.worker");
    const { createEmailWorker } = await import("~/workers/email.worker");
    startCollectionWorkers();
    createEmailWorker();
    logger.app("INFO", "All background workers started");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Background workers not started (expected in dev without Redis)", msg);
  }
}

// Register daily sweep cron (9:00 AM UTC = 5:00 AM EST)
let _cronStarted = false;
function ensureCron() {
  if (_cronStarted) return;
  _cronStarted = true;

  // Check if cron job already registered (dev hot-reload guard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- node-cron types
  const existing = (cron as any)._tasks?.size ?? 0;
  if (existing > 0) return;

  cron.schedule("0 9 * * *", async () => {
    logger.app("INFO", "Daily collection sweep triggered via cron");
    await enqueueSweep();
  });

  logger.app("INFO", "Collection sweep cron registered (daily at 09:00 UTC)");
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  // Start background services on first request
  ensureWorkers();
  ensureCron();

  const url = new URL(request.url);
  const requestId =
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6);

  const pathname = url.pathname;
  const shouldLog = !pathname.startsWith("/build/") && !pathname.startsWith("/assets/");

  return withRequestContext(
    { requestId, path: pathname, method: request.method },
    () => {
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

              resolve(
                new Response(stream, {
                  headers: responseHeaders,
                  status: responseStatusCode,
                }),
              );
              pipe(body);
            },
            onShellError(error) {
              const duration = Date.now();
              if (shouldLog) {
                // eslint-disable-next-line no-console
                console.error(
                  JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: "ERROR",
                    service: "Request",
                    requestId,
                    path: pathname,
                    message: "SSR shell error",
                    error: (error as Error)?.message,
                    durationMs: duration,
                  }),
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
