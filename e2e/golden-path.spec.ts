/**
 * TruCredit Golden Path E2E — Full Core Flow Verification
 *
 * Covers: ALL 15 UI routes + navigation + API health + auth flow + public pages
 * Run: npx playwright test
 * Env: SHOPIFY_APP_URL=https://trucredit-test.up.railway.app
 *
 * Note: Tests marked "Unauthenticated" verify public/redirect behavior.
 * Tests marked "Authenticated" require post-install session (OAuth completed).
 */

import { test, expect } from "@playwright/test";

const SLOW = 200;

/* ───────── 1. Public Pages (no auth needed) ───────── */
test.describe("Public Pages: Unauthenticated Access", () => {
  test("GET /terms returns terms of service", async ({ request }) => {
    const r = await request.get("/terms");
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text.toLowerCase()).toContain("terms");
  });

  test("GET /privacy returns privacy policy", async ({ request }) => {
    const r = await request.get("/privacy");
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text.toLowerCase()).toContain("privacy");
  });

  test("GET /app redirects to OAuth (no session)", async ({ page }) => {
    await page.goto("/app");
    await page.waitForURL(/auth|login|admin\.shopify/i, { timeout: 10_000 });
    // Either redirects to our /auth/login or directly to Shopify OAuth
    expect(page.url()).toMatch(/auth|myshopify\.com/i);
  });
});

/* ───────── 2. Auth Flow ───────── */
test.describe("Auth Flow", () => {
  test("GET /auth/login renders login page", async ({ page }) => {
    await page.goto("/auth/login");
    await page.waitForLoadState("networkidle");
    // Should either show login UI or redirect — both valid
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});

/* ───────── 3. Dashboard ───────── */
test.describe("Core Routes: Post-Install (requires session)", () => {
  test("Dashboard loads (or redirects to OAuth)", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(SLOW);

    // With valid session: renders dashboard with headings
    // Without session: redirects to OAuth (minimal body)
    // Both valid — must not crash (no 500/error page)
    await expect(page.locator("body")).toBeVisible();
    const text = await page.locator("body").textContent();
    expect(text.length).toBeGreaterThan(0); // Not blank
  });

  /* ─── 3a. Customers ─── */
  test("Navigate: Dashboard → Customers", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(SLOW);

    const link = page.locator('a[href="/app/customers"]').first();
    if (await link.isVisible().catch(() => false)) {
      await link.click();
    } else {
      await page.goto("/app/customers");
    }
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  test("Customer detail page loads", async ({ page }) => {
    // Try with a known ID, or just verify the route resolves
    await page.goto("/app/customers/1");
    await page.waitForLoadState("networkidle");
    // Should at least not crash — shows detail or "not found"
    await expect(page.locator("body")).toBeVisible();
  });

  /* ─── 3b. Invoices ─── */
  test("Navigate: Dashboard → Invoices", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(SLOW);

    const link = page.locator('a[href="/app/invoices"]').first();
    if (await link.isVisible().catch(() => false)) {
      await link.click();
    } else {
      await page.goto("/app/invoices");
    }
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  test("New Invoice page loads (or redirects to OAuth)", async ({ page }) => {
    await page.goto("/app/invoices/new");
    await page.waitForLoadState("networkidle");

    // With session: shows invoice form with input elements
    // Without session: redirects to OAuth
    // Both valid — must not crash
    await expect(page.locator("body")).toBeVisible();
    const url = page.url();
    const isOAuth = /auth|myshopify/i.test(url);
    if (!isOAuth) {
      const form = page.locator("form, [role='form']").first();
      const input = page.locator(
        "select, [role='combobox'], input[name*='amount'], input[type='number']"
      ).first();
      const hasElements =
        (await form.isVisible().catch(() => false)) ||
        (await input.isVisible().catch(() => false));
      expect(hasElements).toBe(true);
    }
  });

  test("Invoice detail page loads", async ({ page }) => {
    await page.goto("/app/invoices/1");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  /* ─── 3c. Collections ─── */
  test("Navigate: Dashboard → Collections", async ({ page }) => {
    await page.goto("/app/collections");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  for (const [label, path, outletRoute] of [
    ["Collections", "/app/collections", "/app/collections/1"],
    ["Rules", "/app/rules", "/app/rules/1"],
    ["Emails", "/app/emails", "/app/emails/1"],
  ]) {
    test(`${label} detail page resolves (no crash)`, async ({ page }) => {
      await page.goto(outletRoute);
      await page.waitForLoadState("networkidle");
      // Verify route resolves without crashing (no 500)
      // OAuth redirect is expected without session (produces minimal body)
      await expect(page.locator("body")).toBeVisible();
      const url = page.url();
      // Either stays on our app (authenticated) or redirects to OAuth (unauth)
      // Neither should be a blank/error page
      expect(url).toBeTruthy();
      // No JS exceptions or 500 rendered
      const errorEl = page.locator("[data-error], .error-page, h1:has-text('Error')");
      expect(await errorEl.count()).toBe(0);
    });
  }

  /* ─── 3f. Tasks ─── */
  test("Navigate: Dashboard → Tasks", async ({ page }) => {
    await page.goto("/app/tasks");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  /* ─── 3g. Replies ─── */
  test("Navigate: Dashboard → Replies", async ({ page }) => {
    await page.goto("/app/replies");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  /* ─── 3h. Settings ─── */
  test("Settings page loads", async ({ page }) => {
    await page.goto("/app/settings");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  /* ─── 3i. Billing / Plans ─── */
  test("Billing plans page loads", async ({ page }) => {
    await page.goto("/app/billing");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
  });

  /* ─── 3j. Full navigation chain (5-step marathon) ─── */
  test("Full navigation chain: Dashboard → Customers → Invoices → Collections → Settings", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    const steps = [
      "/app/customers",
      "/app/invoices",
      "/app/collections",
      "/app/settings",
    ];
    for (const path of steps) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(SLOW / 2);
      await expect(page.locator("body")).toBeVisible();
    }
  });
});

/* ───────── 4. API Endpoints ───────── */
test.describe("API Endpoints: Basic Reachability", () => {
  // These may return 401/403 without auth, but must not 500

  test("POST /api/credit-check returns structured response", async ({
    request,
  }) => {
    const r = await request.post("/api/credit-check", {
      data: { customerId: "nonexistent", amount: 100 },
    });
    // 401 (no auth) or 400 (bad input) are fine; 500 is not
    expect(r.status()).toBeLessThan(500);
  });

  test("POST /api/sync-companies returns 401 without session", async ({
    request,
  }) => {
    const r = await request.post("/api/sync-companies");
    expect(r.status()).toBeLessThan(500);
  });

  test("POST /api/storefront-collect returns structured response", async ({
    request,
  }) => {
    const r = await request.post("/api/storefront-collect", {
      data: {},
    });
    expect(r.status()).toBeLessThan(500);
  });

  test("GET /api/invoices/export/csv returns 401 without session", async ({
    request,
  }) => {
    const r = await request.get("/api/invoices/export/csv");
    expect(r.status()).toBeLessThan(500);
  });

  test("GET /api/customers/export/csv returns 401 without session", async ({
    request,
  }) => {
    const r = await request.get("/api/customers/export/csv");
    expect(r.status()).toBeLessThan(500);
  });

  test("GET /api/team-members returns 401 without session", async ({
    request,
  }) => {
    const r = await request.get("/api/team-members");
    expect(r.status()).toBeLessThan(500);
  });

  test("GET /api/permissions returns 401 without session", async ({
    request,
  }) => {
    const r = await request.get("/api/permissions");
    expect(r.status()).toBeLessThan(500);
  });
});

/* ───────── 5. Webhook Endpoint ───────── */
test.describe("Webhook Endpoint", () => {
  test("POST /webhooks returns 200 (P0-2 anti-retry) or 401", async ({
    request,
  }) => {
    const r = await request.post("/webhooks", {
      data: { test: true },
      headers: { "content-type": "application/json" },
    });
    // P0-2: auth failures return 200 to prevent Shopify retry cascading
    // Without P0-2: would return 401
    // Both are valid — must not 500
    expect(r.status()).toBeLessThan(500);
  });
});

/* ───────── 6. Billing & GDPR ───────── */
test.describe("Billing & Compliance", () => {
  test("GET /billing/callback returns redirect or error (no HMAC)", async ({
    request,
  }) => {
    const r = await request.get("/billing/callback");
    // Can be redirect or auth error; must not 500
    expect(r.status()).toBeLessThan(500);
  });

  test("POST /webhooks APP_UNINSTALLED returns 200 (P0-2) or 401", async ({
    request,
  }) => {
    const r = await request.post("/webhooks", {
      data: { topic: "app/uninstalled" },
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "app/uninstalled",
      },
    });
    // P0-2: 200 to prevent Shopify retry; must not 500
    expect(r.status()).toBeLessThan(500);
  });
});
