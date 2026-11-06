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
