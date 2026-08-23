import { test, expect } from "@playwright/test";

test("landing page logs no Base UI or hydration console errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(msg.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("build themselves");
  const baseUiIssues = problems.filter(
    (t) => t.includes("Base UI") || t.includes("hydrated but some attributes"),
  );
  expect(baseUiIssues).toEqual([]);
});
