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
import { bootstrap } from "~/bootstrap.server";

// ── Bootstrap: dev seed, cron, workers, graceful shutdown ──
bootstrap();

export const streamTimeout = 5000;

const FALLBACK_HTML = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"/><title>Loading…</title></head>
  <body>
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;color:#64748b;font-size:16px;">
      <div style="text-align:center;">
        <p style="margin:0;font-weight:600;color:#1e293b;">Loading your app…</p>
        <p style="margin:8px 0 0;font-size:14px;">If this doesn’t load, please refresh the page.</p>
      </div>
    </div>
  </body>
</html>`;

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

  // Health check endpoint — Railway health probe with DB + Redis checks
  if (pathname === "/health") {
    const [dbOk, redisOk] = await Promise.all([
      import("~/db.server")
        .then(({ default: p }) =>
          p.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
        )
        .catch(() => false),
      import("~/lib/redis.server")
        .then(({ default: r }) => r.status === "ready")
        .catch(() => false),
    ]);
    const healthy = dbOk && redisOk;
    return new Response(
      JSON.stringify({
        status: healthy ? "ok" : "degraded",
        db: dbOk,
        redis: redisOk,
        uptime: process.uptime(),
      }),
      {
        status: healthy ? 200 : 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    return await withRequestContext(
      { requestId, path: pathname, method: request.method },
      () => {
        // Log request start
        if (shouldLog) {
          logger.request("INFO", `→ ${request.method} ${pathname}`);
        }

        addDocumentResponseHeaders(request, responseHeaders);
        const userAgent = request.headers.get("user-agent");
        const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

        return new Promise<Response>((resolve, reject) => {
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
              onShellError(error: unknown) {
                const duration = Date.now() - startTime;
                if (shouldLog) {
                  logger.request(
                    "ERROR",
                    `SSR shell error ${pathname}`,
                    duration,
                    { error: error instanceof Error ? error.message : String(error) },
                  );
                }
                reject(error);
              },
              onError(_error: unknown) {
                responseStatusCode = 500;
                if (shouldLog) {
                  logger.request(
                    "ERROR",
                    `SSR stream error ${pathname}`,
                    Date.now() - startTime,
                    { error: _error instanceof Error ? _error.message : String(_error) },
                  );
                }
              },
            },
          );

          setTimeout(abort, streamTimeout + 1000);
        });
      },
    );
  } catch (e: unknown) {
    // Catch-all: never let the server return a raw 502 — always an HTML page
    const duration = Date.now() - startTime;
    const msg = e instanceof Error ? e.message : String(e);
    if (shouldLog) {
      logger.request("ERROR", `FATAL CRASH ${pathname}`, duration, { error: msg });
    }
    return new Response(FALLBACK_HTML, {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}
