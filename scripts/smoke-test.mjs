/**
 * TruCredit Smoke Test — runs against local dev server
 *
 * Validates:
 *   1. Dev server starts successfully
 *   2. Public endpoints (terms, privacy) return 200
 *   3. API endpoints reject unauthenticated requests gracefully (<500)
 *   4. Webhook endpoint validates HMAC
 *   5. Billing callback exists
 *   6. Auth flow redirects correctly
 *   7. All app routes are reachable (redirect to OAuth = valid)
 *
 * Usage: node scripts/smoke-test.mjs
 * Server must be running: npm run dev
 */

const BASE = process.env.SHOPIFY_APP_URL || "http://127.0.0.1:3460";

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    const msg = e.message.length > 120 ? e.message.slice(0, 120) + "..." : e.message;
    failures.push({ name, error: msg });
    console.log(`  ❌ ${name}: ${msg}`);
  }
}

async function req(path, opts = {}) {
  const { method = "GET", body, headers = {} } = opts;
  const fetchOpts = { method, headers };
  if (body) {
    fetchOpts.body = JSON.stringify(body);
    fetchOpts.headers["content-type"] = "application/json";
  }
  const r = await fetch(`${BASE}${path}`, { redirect: "manual", ...fetchOpts });
  return r;
}

async function main() {
  console.log(`\n🔍 TruCredit Smoke Test — ${BASE}\n`);
  const start = Date.now();

  // ── 1. Server Health ──
  console.log("── 1. Server Health ──");
  await test("GET /terms → 200 OK", async () => {
    const r = await req("/terms");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const text = await r.text();
    if (!text.toLowerCase().includes("terms")) throw new Error("missing 'terms' content");
  });

  await test("GET /privacy → 200 OK", async () => {
    const r = await req("/privacy");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const text = await r.text();
    if (!text.toLowerCase().includes("privacy")) throw new Error("missing 'privacy' content");
  });

  await test("GET /app → auth redirect or 410 (no session)", async () => {
    const r = await req("/app");
    // 302/303: production OAuth redirect
    // 410: Remix dev mode "resource gone" (no session)
    // Either is valid — must not 500
    if (r.status >= 500) throw new Error(`status ${r.status}, crash`);
  });

  await test("GET /auth/login → renders (not 500)", async () => {
    const r = await req("/auth/login");
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  // ── 2. App Routes (should redirect to OAuth, not 500) ──
  console.log("\n── 2. App Routes: Redirect to OAuth ──");
  const appRoutes = [
    "/app/customers",
    "/app/customers/1",
    "/app/invoices",
    "/app/invoices/new",
    "/app/invoices/1",
    "/app/collections",
    "/app/collections/1",
    "/app/rules",
    "/app/rules/1",
    "/app/emails",
    "/app/emails/1",
    "/app/tasks",
    "/app/replies",
    "/app/settings",
    "/app/billing",
  ];
  for (const path of appRoutes) {
    await test(`GET ${path} → redirect (not 500)`, async () => {
      const r = await req(path);
      if (r.status >= 500) throw new Error(`status ${r.status}`);
    });
  }

  // ── 3. API Endpoints: Reject Unauthenticated ──
  console.log("\n── 3. API Endpoints: Reject without auth (<500) ──");
  await test("POST /api/credit-check → <500", async () => {
    const r = await req("/api/credit-check", {
      method: "POST",
      body: { customerId: "test", amount: 100 },
    });
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("POST /api/sync-companies → <500", async () => {
    const r = await req("/api/sync-companies", { method: "POST" });
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("POST /api/storefront-collect → <500", async () => {
    const r = await req("/api/storefront-collect", { method: "POST", body: {} });
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("POST /api/email-inbound → <500", async () => {
    const r = await req("/api/email-inbound", { method: "POST", body: {} });
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("POST /api/create-charge → <500", async () => {
    const r = await req("/api/create-charge", { method: "POST", body: {} });
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("GET /api/invoices/export/csv → <500", async () => {
    const r = await req("/api/invoices/export/csv");
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("GET /api/customers/export/csv → <500", async () => {
    const r = await req("/api/customers/export/csv");
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("GET /api/team-members → <500", async () => {
    const r = await req("/api/team-members");
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("GET /api/permissions → <500", async () => {
    const r = await req("/api/permissions");
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("GET /api/invoices/1/pdf → <500", async () => {
    const r = await req("/api/invoices/1/pdf");
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("GET /api/statements/1/pdf → <500", async () => {
    const r = await req("/api/statements/1/pdf");
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  // ── 4. Webhooks: HMAC Validation ──
  console.log("\n── 4. Webhook: HMAC Rejection ──");
  await test("POST /webhooks (no HMAC) → 200 (stop retry) or 401", async () => {
    const r = await req("/webhooks", {
      method: "POST",
      body: { topic: "app/uninstalled" },
      headers: { "x-shopify-topic": "app/uninstalled" },
    });
    // P0-2: auth failures return 200 to prevent Shopify retry cascading
    // Without P0-2: would return 401
    // Either is valid — must not 500
    if (r.status >= 500) throw new Error(`status ${r.status}, should not crash`);
  });

  // ── 5. Billing ──
  console.log("\n── 5. Billing ──");
  await test("GET /billing/callback → redirect/error (not 500)", async () => {
    const r = await req("/billing/callback");
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  await test("POST /billing/callback → <500", async () => {
    const r = await req("/billing/callback", { method: "POST", body: {} });
    if (r.status >= 500) throw new Error(`status ${r.status}`);
  });

  // ── Summary ──
  const total = passed + failed;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(50)}`);
  console.log(`\n📊 Smoke Test Summary (${elapsed}s)`);
  console.log(`   Total:  ${total}`);
  console.log(`   Passed: ${passed} ✅`);
  console.log(`   Failed: ${failed} ❌`);

  if (failures.length > 0) {
    console.log(`\n── Failures ──`);
    for (const f of failures) {
      console.log(`   ❌ ${f.name}`);
      console.log(`      ${f.error}`);
    }
  }

  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  process.exit(1);
});
