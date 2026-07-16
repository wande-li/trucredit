#!/usr/bin/env node
// PRE-DELIVERY VERIFICATION
// Usage: node scripts/pre-delivery-check.cjs

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(ROOT, "app");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); }
  catch (e) { console.log(`  ❌ ${name}: ${e.message}`); failures++; }
}

console.log("\n╔═══════════════════════════════════════════╗");
console.log("║   PRE-DELIVERY VERIFICATION              ║");
console.log("╚═══════════════════════════════════════════╝\n");

// Step 1: ESLint
console.log("🔍 Step 1: ESLint...");
check("ESLint clean", () => {
  const stdout = execSync(
    `npx eslint app/ --format json`,
    { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
  );
  const results = JSON.parse(stdout);
  const errors = results.reduce((s, r) => s + (r.errorCount || 0), 0);
  const warnings = results.reduce((s, r) => s + (r.warningCount || 0), 0);
  if (errors > 0 || warnings > 0) {
    throw new Error(`${errors} error(s), ${warnings} warning(s)`);
  }
});

// Step 2: TypeScript
console.log("🔍 Step 2: TypeScript typecheck...");
check("TypeScript clean", () => {
  execSync(`npx tsc --noEmit`, {
    cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8",
  });
});

// Step 3: Forbidden patterns
console.log("🔍 Step 3: Forbidden patterns scan...");

const FORBIDDEN = [
  { pattern: /\bas any\b/, desc: "as any" },
  { pattern: /\b(err|error)\s*:\s*any\b/, desc: "err:any / error:any" },
  { pattern: /\(prisma as any\)/, desc: "(prisma as any)" },
  { pattern: /Record<string,\s*any>/, desc: "Record<string, any>" },
  { pattern: /catch\s*\(\s*\)\s*\{/, desc: "empty catch() {}" },
  { pattern: /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/, desc: "silent catch block" },
];

function scanDir(dir) {
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
      files.push(...scanDir(full));
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = scanDir(APP_DIR);

for (const { pattern, desc } of FORBIDDEN) {
  let hits = [];
  for (const file of allFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("eslint-disable")) continue;
      if (pattern.test(lines[i])) {
        hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    }
  }
  check(`No "${desc}"`, () => {
    if (hits.length > 0) throw new Error(`Found ${hits.length} violations:\n    ${hits.join("\n    ")}`);
  });
}

// Step 4: Console residues
console.log("🔍 Step 4: Unauthorized console statements...");
const CONSOLE_PATTERN = /^\s*console\.(log|error|warn|debug)\(/;
const ALLOWED_FILES = [
  "app/services/logger.server.ts",
  "app/entry.server.tsx",
];

let consoleHits = [];
for (const file of allFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (ALLOWED_FILES.includes(rel)) continue;
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("eslint-disable-next-line no-console")) continue;
    if (i > 0 && lines[i - 1].includes("eslint-disable-next-line no-console")) continue;
    if (CONSOLE_PATTERN.test(lines[i])) {
      consoleHits.push(`${rel}:${i + 1}`);
    }
  }
}
check("No unauthorized console", () => {
  if (consoleHits.length > 0) throw new Error(`Found ${consoleHits.length} violations:\n    ${consoleHits.join("\n    ")}`);
});

// Summary
console.log(
  `\n${"=".repeat(40)}\n${failures === 0 ? "✅ ALL CHECKS PASSED — SAFE TO DELIVER" : `❌ ${failures} CHECK(S) FAILED — FIX BEFORE DELIVERY`}\n${"=".repeat(40)}\n`
);

process.exit(failures > 0 ? 1 : 0);
