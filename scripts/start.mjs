/**
 * remix-serve startup script with HOST sanitization + auto-migration.
 */
import { spawn, execSync } from "node:child_process";

// Step 0: Sync Prisma schema → database (adds missing columns, never drops)
try {
  console.log("[start] Running prisma db push...");
  execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
  console.log("[start] Schema sync completed.");
} catch (e) {
  console.error("[start] Schema sync failed:", e.message);
  // Don't crash — the app may still work if schema is compatible
}

const rawHost = process.env.HOST;
if (rawHost) {
  let cleaned = rawHost;
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }

  try {
    const parsed = new URL(cleaned);
    process.env.HOST = parsed.hostname;
  } catch {
    if (cleaned.includes("://")) {
      const hostname = (cleaned.replace(/^https?:\/\//, "").split("/")[0] || "").split(":")[0] || cleaned;
      process.env.HOST = hostname;
    } else {
      process.env.HOST = cleaned;
    }
  }
}

const child = spawn(
  process.execPath,
  ["./node_modules/@remix-run/serve/dist/cli.js", "./build/server/index.js"],
  {
    stdio: "inherit",
    env: process.env,
  },
);

child.on("close", (code) => {
  process.exit(code ?? 1);
});
