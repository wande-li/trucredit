import { test, expect } from "@playwright/test";

test.describe("Authentication Flow", () => {
  test("health check returns 200", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBe(true);
    expect(body.redis).toBe(true);
  });

  test("protected route redirects to auth", async ({ page }) => {
    const res = await page.request.get("/app", { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
  });
});

test.describe("Core Business Paths", () => {
  test("dashboard loads with 200", async ({ page }) => {
    // This test requires authenticated session — setup via OAuth mock
    test.skip(true, "Requires OAuth mock setup");
  });
});
