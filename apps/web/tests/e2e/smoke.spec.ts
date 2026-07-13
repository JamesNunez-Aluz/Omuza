import { expect, test } from "@playwright/test";

test("home page renders with security headers", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(page.getByRole("heading", { name: "Resonance" })).toBeVisible();
});

test("liveness endpoint answers", async ({ request }) => {
  const response = await request.get("/health/live");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
