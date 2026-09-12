import { test, expect } from "@playwright/test";

test("all pages load with working assets and no client exceptions", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", e => failures.push(e.message));
  page.on("response", r => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  for (const name of ["index", "levels", "technology", "world", "play"]) {
    await page.goto(`${name}.html`);
    await expect(page.locator("h1").first()).toBeVisible();
    await page.evaluate(async () => { await Promise.all(Array.from(document.images, image => { image.loading = "eager"; return image.decode().catch(() => null); })); });
    expect(await page.locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  }
  expect(failures).toEqual([]);
});

test("mobile navigation and game fit a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("levels.html");
  await page.getByText("Menu", { exact: true }).click();
  await expect(page.locator(".mobile-menu").getByRole("link", { name: "Technology" })).toBeVisible();
  await page.getByRole("link", { name: "Initialize Keymaster" }).click();
  await expect(page.getByRole("textbox")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Keymaster: charter lock, three trials, results and replay", async ({ page }) => {
  await page.clock.install();
  await page.goto("play.html#key");
  await page.getByRole("textbox").fill("Исследуй мир, найди ключ, вернись к двери, открой её и достигни алтаря.");
  await page.getByRole("button", { name: "Оживить", exact: true }).click();
  await expect(page.getByText("LOCKED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "02 / Keymaster" })).toBeDisabled();
  for (let i = 0; i < 15 && !await page.getByRole("button", { name: "See results" }).isVisible(); i++) await page.clock.runFor(10000);
  await page.getByRole("button", { name: "See results" }).click();
  await expect(page.getByText("KEYMASTER COMPLETE", { exact: true })).toBeVisible();
  await expect(page.getByText(/3\/3 LEVELS PASSED/)).toBeVisible();
  await page.getByRole("button", { name: /Replay/ }).first().click();
  await expect(page.getByRole("slider", { name: "Replay position" })).toBeVisible();
  await page.getByRole("button", { name: "Step ▶", exact: true }).click();
  await expect(page.getByRole("slider")).toHaveValue("1");
  await page.getByRole("button", { name: "Back to results" }).click();
  await page.getByRole("button", { name: "Изменить устав" }).click();
  await expect(page.getByRole("textbox")).toHaveValue("Исследуй мир, найди ключ, вернись к двери, открой её и достигни алтаря.");
});

test("stale run link offers recovery", async ({ page }) => {
  await page.goto("play.html#run/mock-expired");
  await expect(page.getByRole("heading", { name: "Run unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Open the facility" }).click();
  await expect(page.getByRole("heading", { name: "Red Floor", exact: true })).toBeVisible();
});
