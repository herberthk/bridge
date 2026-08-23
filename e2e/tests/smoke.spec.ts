import { test, expect } from "@playwright/test";

/**
 * Smoke tests — cover the public routing surface and optimistic redirects.
 * Authenticated journeys (setup → login → exam) run separately with a
 * configured Firebase backend (E2E_HAS_BACKEND=1).
 */

test.describe("public pages", () => {
  test("landing page renders the hero", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toContainText("build themselves");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  });

  test("login screen renders the form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("setup page loads when not completed", async ({ page }) => {
    await page.goto("/setup");
    // Either the setup form (fresh install) or the redirect notice.
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test("manifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { name: string };
    expect(body.name).toContain("Bridge");
  });
});

test.describe("optimistic auth redirects", () => {
  test("protected /admin bounces to /login with a next param", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  });

  test("protected /student bounces to /login", async ({ page }) => {
    await page.goto("/student");
    await expect(page).toHaveURL(/\/login/);
  });

  test("exam runner route is protected", async ({ page }) => {
    await page.goto("/exam/abc123");
    await expect(page).toHaveURL(/\/login/);
  });
});

// Full authenticated flow — executed only with a live backend.
test.describe("authenticated exam flow (needs backend)", () => {
  test.skip(!process.env.E2E_HAS_BACKEND, "Requires a seeded Firebase backend");

  test("student can sign in and see the dashboard", async ({ page }) => {
    test.skip(!process.env.E2E_STUDENT_EMAIL, "E2E_STUDENT_EMAIL not set");
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_STUDENT_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_STUDENT_PASSWORD ?? "");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/student/, { timeout: 30_000 });
  });
});
