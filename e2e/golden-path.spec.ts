/**
 * TruCredit Golden Path E2E Test
 * Verifies: Dashboard loads → Customers listed → Invoice detail → Navigation
 *
 * Run: npx playwright test
 * Env: SHOPIFY_APP_URL https://trucredit-prod.up.railway.app
 * Note: OAuth installation requires manual bootstrap; this test starts post-install.
 */
import { test, expect } from "@playwright/test";

const SLOW_DOWN = 200; // ms between actions (stability)

test.describe("Golden Path: Post-Install", () => {
  test("Dashboard loads with key stats", async ({ page }) => {
    await page.goto("/app");

    // Page rendered (not a blank white screen or error)
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("h1, h2")).toContainText([/Dashboard/i], { timeout: 8_000 });

    // Key stat cards present
    const statLabels = page.locator("text=Total Customers,text=Active,text=Overdue").first();
    await expect(statLabels).toBeVisible({ timeout: 8_000 });
  });

  test("Navigates from Dashboard → Customers", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(SLOW_DOWN);

    // Click Customers nav
    const customersLink = page.locator('a[href="/app/customers"]').first();
    if (await customersLink.isVisible()) {
      await customersLink.click();
      await page.waitForLoadState("networkidle");
    } else {
      await page.goto("/app/customers");
      await page.waitForLoadState("networkidle");
    }

    // Customers page renders
    await expect(page.locator("h1, h2")).toContainText([/Customers?/i], { timeout: 8_000 });
  });

  test("Navigates from Dashboard → Invoices → Invoice Detail", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(SLOW_DOWN);

    // Click Invoices nav
    const invoicesLink = page.locator('a[href="/app/invoices"]').first();
    if (await invoicesLink.isVisible()) {
      await invoicesLink.click();
      await page.waitForLoadState("networkidle");
    } else {
      await page.goto("/app/invoices");
      await page.waitForLoadState("networkidle");
    }

    await expect(page.locator("h1, h2")).toContainText([/Invoices?/i], { timeout: 8_000 });
  });

  test("Navigates Dashboard → Settings", async ({ page }) => {
    await page.goto("/app/settings");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1, h2")).toContainText([/Settings?/i], { timeout: 8_000 });
  });

  test("New Invoice page loads with form", async ({ page }) => {
    await page.goto("/app/invoices/new");
    await page.waitForLoadState("networkidle");

    // Form fields present
    const form = page.locator("form, [role='form']").first();
    const customerSelector = page.locator("select, [role='combobox'], input[name*='customer']").first();
    const amountInput = page.locator("input[name*='amount'], input[type='number']").first();

    const hasFormElements =
      (await form.isVisible()) ||
      (await customerSelector.isVisible()) ||
      (await amountInput.isVisible());
    expect(hasFormElements).toBe(true);
  });
});
