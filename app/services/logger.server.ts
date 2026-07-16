// TruCredit — Structured Logger v1.0
// AsyncLocalStorage: requestId/shop auto-enrichment on every log line
/* eslint-disable no-console -- logger implementation */

import { AsyncLocalStorage } from "async_hooks";

type LogLevel = "INFO" | "WARN" | "ERROR" | "FATAL";

interface RequestContext {
  requestId: string;
  shop?: string;
  path?: string;
  method?: string;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  error?: string;
  context?: Record<string, unknown>;
  requestId?: string;
  shop?: string;
  path?: string;
  method?: string;
  durationMs?: number;
}

const requestStore = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestStore.getStore();
}

export function setRequestContext(ctx: Partial<RequestContext>): void {
  const existing = requestStore.getStore();
  if (existing) Object.assign(existing, ctx);
}

export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestStore.run(ctx, fn);
}

const logBuffer: LogEntry[] = [];
const MAX_BUFFER = 500;

function addLog(entry: LogEntry) {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER) logBuffer.shift();

  const reqCtx = requestStore.getStore();
  if (reqCtx) {
    if (!entry.requestId) entry.requestId = reqCtx.requestId;
    if (reqCtx.shop && !entry.shop) entry.shop = reqCtx.shop;
    if (reqCtx.path && !entry.path) entry.path = reqCtx.path;
    if (reqCtx.method && !entry.method) entry.method = reqCtx.method;
  }

  const line = JSON.stringify(entry);
  if (entry.level === "ERROR" || entry.level === "FATAL") {
    console.error(line);
  } else if (entry.level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function toErrorString(error: unknown): string {
  return error instanceof Error ? error.message : error !== undefined ? String(error) : "";
}

export const logger = {
  shopify(level: LogLevel, message: string, error?: unknown, context?: Record<string, unknown>) {
    addLog({
      timestamp: new Date().toISOString(),
      level, service: "Shopify", message,
      error: toErrorString(error), context,
    });
  },

  deepseek(level: LogLevel, message: string, error?: unknown, context?: Record<string, unknown>) {
    addLog({
      timestamp: new Date().toISOString(),
      level, service: "DeepSeek", message,
      error: toErrorString(error), context,
    });
  },

  app(level: LogLevel, message: string, error?: unknown, context?: Record<string, unknown>) {
    addLog({
      timestamp: new Date().toISOString(),
      level, service: "App", message,
      error: toErrorString(error), context,
    });
  },

  request(level: LogLevel, message: string, durationMs?: number, context?: Record<string, unknown>) {
    addLog({
      timestamp: new Date().toISOString(),
      level, service: "Request", message,
      durationMs, context,
    });
  },

  getRecent(count = 50): LogEntry[] {
    return logBuffer.slice(-count);
  },

  getErrors(count = 50): LogEntry[] {
    return logBuffer.filter((e) => e.level === "ERROR" || e.level === "FATAL").slice(-count);
  },
};
