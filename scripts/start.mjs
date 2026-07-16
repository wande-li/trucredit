/**
 * remix-serve startup script with HOST sanitization.
 */
import { spawn } from "node:child_process";

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
      const hostname = cleaned.replace(/^https?:\/\//, "").split("/")[0]!.split(":")[0]!;
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
