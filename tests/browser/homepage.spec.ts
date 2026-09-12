import { test, expect } from '@playwright/test';
const launchUrl = 'https://demkin76.github.io/prompt_tutor/play.html#all';

test('homepage launches the all-modes facility and removes Levels navigation', async ({ page }) => {
  await page.goto('index.html');
  await expect(page.getByRole('link', { name: /levels/i })).toHaveCount(0);
  const launches = page.getByRole('link', { name: 'Launch game' });
  await expect(launches).toHaveCount(3);
  for (const link of await launches.all()) await expect(link).toHaveAttribute('href', launchUrl);
  // Intercept the exact production destination to verify the link without leaving the test server.
  await page.route(launchUrl.split('#')[0], route => route.fulfill({ contentType: 'text/html', body: '<h1>Facility destination</h1>' }));
  await launches.first().click();
  await expect(page).toHaveURL(launchUrl);
});

test('interface gallery supports keyboard navigation and accessible expansion', async ({ page }) => {
  await page.goto('index.html');
  const first = page.getByRole('tab', { name: /Choose a mode/ });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Write a charter/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#interface-image')).toHaveAttribute('src', /charter.jpg$/);
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Inspect results/ })).toBeFocused();
  await page.getByRole('button', { name: 'Enlarge interface screenshot' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src', /results.jpg$/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Enlarge interface screenshot' })).toBeFocused();
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click();
    expect(await page.locator('#interface-image').evaluate(async (img: HTMLImageElement) => { await img.decode(); return img.naturalWidth > 0; })).toBe(true);
  }
});

test('homepage fits mobile and motion preference persists', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('index.html');
  await page.getByRole('button', { name: 'Pause animations' }).click();
  await expect(page.locator('html')).toHaveClass(/motion-paused/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume animations' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Open navigation', { exact: true }).click();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Experience' }).click();
  await expect(page.locator('.mobile-menu')).not.toHaveAttribute('open');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion' })).toBeDisabled();
  expect(await page.locator('.title-mask > span').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await expect(page.getByRole('heading', { name: 'Small world. Big consequences.' })).toBeVisible();
});
