import { expect, test } from '@playwright/test';

test('mobile: no horizontal scroll, votes open as a bottom sheet', async ({ page }) => {
  await page.goto('/g/demo-s1?t=60');
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);
  await page.getByRole('button', { name: 'Open votes panel' }).click();
  const sheet = page.getByRole('dialog', { name: 'Game panel' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Now')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('mobile: no page is wider than a small phone (320px), even with long game titles', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ['/', '/leaderboard', '/play', '/about', '/models/claude-haiku', '/g/demo-s1?t=60']) {
    await page.goto(path);
    if (path === '/') {
      // the longest real titles have six model names
      await page.locator('[aria-labelledby=recent] li a span').first().evaluate((el) => {
        el.textContent = 'Claude Haiku · Claude Opus · Gemini Flash · GPT mini · Llama 3.3 70B · Qwen3 235B';
      });
    }
    const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
    expect(sw, `${path} overflows`).toBeLessThanOrEqual(vw);
  }
});

test('mobile: top bar fits without scrolling; Menu opens the links', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/leaderboard');
  const bar = await page.locator('header > div').first().evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(bar.sw).toBeLessThanOrEqual(bar.cw);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('#mobile-menu').getByRole('link', { name: 'Play live' }).click();
  await expect(page).toHaveURL(/\/play$/);
});
