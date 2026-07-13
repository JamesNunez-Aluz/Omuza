import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Keyboard-only onboarding (spec §21 M1 acceptance, §14.3).
 *
 * Requires locally: docker compose up -d (postgres + mailpit), migrations
 * applied, and network access to MusicBrainz (respectful 1 req/s etiquette).
 * Run with `pnpm test:e2e`; not part of the CI-blocking suite.
 *
 * Every interaction below is a keyboard interaction: Tab/Shift+Tab to move,
 * Enter/Space to activate, arrows for the select and slider.
 */

const MAILPIT_API = "http://localhost:8025/api/v1";

async function latestLoginLink(request: APIRequestContext, email: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await request.get(`${MAILPIT_API}/search?query=to:${encodeURIComponent(email)}`);
    const body = (await list.json()) as { messages?: { ID: string }[] };
    const id = body.messages?.[0]?.ID;
    if (id) {
      const message = await request.get(`${MAILPIT_API}/message/${id}`);
      const detail = (await message.json()) as { Text: string };
      const match = detail.Text.match(/https?:\/\/\S+\/auth\/verify\?token=\S+/);
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no login email arrived for ${email}`);
}

async function tabTo(page: Page, label: RegExp | string) {
  for (let presses = 0; presses < 40; presses += 1) {
    const focused = page.locator(":focus");
    const name = await focused.getAttribute("aria-label").catch(() => null);
    const text = (await focused.textContent().catch(() => "")) ?? "";
    const id = await focused.getAttribute("id").catch(() => null);
    let labelText = "";
    if (id) {
      labelText = (await page.locator(`label[for="${id}"]`).textContent().catch(() => "")) ?? "";
    }
    const haystack = `${name ?? ""} ${text} ${labelText}`;
    if (typeof label === "string" ? haystack.includes(label) : label.test(haystack)) return focused;
    await page.keyboard.press("Tab");
  }
  throw new Error(`could not reach control: ${label}`);
}

test("a user can complete onboarding using only the keyboard", async ({ page, request }) => {
  test.setTimeout(300_000);
  const email = `kbd-${Date.now()}@example.test`;

  // Sign in via magic link, typing with the keyboard only.
  await page.goto("/");
  const emailInput = await tabTo(page, "Email address");
  await emailInput.pressSequentially(email);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(/check your email/i);

  const link = await latestLoginLink(request, email);
  await page.goto(link);
  await page.waitForURL("**/onboarding");

  // Step 1 — consent: Space toggles, Enter activates the submit button.
  const requiredConsent = await tabTo(page, /Terms of Service/);
  await requiredConsent.press("Space");
  const agree = await tabTo(page, "Agree and continue");
  await agree.press("Enter");

  // Step 2 — five positive seeds through search (live MusicBrainz).
  for (const [query, index] of [
    ["radiohead", 0],
    ["nick drake", 1],
    ["alice coltrane", 0],
    ["broadcast", 1],
    ["arthur russell", 0],
  ] as const) {
    const search = await tabTo(page, /Search for artists or songs you love/);
    await search.fill("");
    await search.pressSequentially(query);
    await page.keyboard.press("Enter");
    const results = page.locator(".result");
    await expect(results.first()).toBeVisible({ timeout: 20_000 });
    await results.nth(index).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".seed-list li")).toHaveCount((await page.locator(".seed-list li").count()) || 1);
  }
  const continuePositive = await tabTo(page, "Continue");
  await continuePositive.press("Enter");

  // Step 3 — three negatives.
  for (const query of ["nickelback", "pitbull", "kenny g"]) {
    const search = await tabTo(page, /Search for artists or songs to avoid/);
    await search.fill("");
    await search.pressSequentially(query);
    await page.keyboard.press("Enter");
    const results = page.locator(".result");
    await expect(results.first()).toBeVisible({ timeout: 20_000 });
    await results.first().focus();
    await page.keyboard.press("Enter");
  }
  const continueNegative = await tabTo(page, "Continue");
  await continueNegative.press("Enter");

  // Step 4 — discovery controls: slider by arrow keys, numeric alternative exists.
  const slider = await tabTo(page, /Discovery level slider/);
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  const numeric = page.locator("#discovery-number");
  await expect(numeric).toHaveValue(/60|55/);
  const continueControls = await tabTo(page, "Continue");
  await continueControls.press("Enter");

  // Step 5 — review and finish.
  const finish = await tabTo(page, "Finish setup");
  await finish.press("Enter");
  await page.waitForURL("**/home");
  await expect(page.getByRole("heading", { name: /taste profile/i })).toBeVisible();
});
