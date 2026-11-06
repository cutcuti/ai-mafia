import { expect, test } from '@playwright/test';

test.describe('leaderboard, profiles, head-to-head, about', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop flow');

  test('leaderboard: tabs, provisional section, CI bars; through to a profile and a head-to-head', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page.getByRole('heading', { name: 'Which AI lies best?' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Best Liars/ })).toHaveAttribute('aria-selected', 'true');
    // fixtures have 1 game per side → everyone is provisional and unranked
    await expect(page.getByText(/Provisional — fewer than 50 games/)).toBeVisible();
    await expect(page.getByRole('img', { name: /95% interval/ }).first()).toBeVisible();

    await page.getByRole('tab', { name: /Best Detectives/ }).click();
    await expect(page).toHaveURL(/scope=as_town/);
    await expect(page.getByRole('tab', { name: /Best Detectives/ })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('link', { name: 'Claude Haiku' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Claude Haiku');
    await expect(page.getByRole('heading', { name: /Playing mafia/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Playing town/ })).toBeVisible();

    await page.getByRole('link', { name: /^vs / }).first().click();
    await expect(page).toHaveURL(/\/h2h\/claude-haiku\/random/);
    await expect(page.getByText(/as mafia vs/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Baselines/ })).toBeVisible();
    // 1 game each way can never settle a pairing
    await expect(page.getByText(/not settled yet/)).toBeVisible();
  });

  test('leaderboard API is cacheable and never ranks provisional models', async ({ request }) => {
    const res = await request.get('/api/leaderboard?scope=overall');
    expect(res.headers()['cache-control']).toContain('s-maxage');
    const body = await res.json();
    expect(body.rows.length).toBeGreaterThan(0);
    for (const r of body.rows) {
      expect(r.provisional).toBe(true);
      expect(r.rank).toBeNull();
    }
  });

  test('unknown model 404s; about renders the methodology', async ({ page, request }) => {
    expect((await request.get('/api/models/nope')).status()).toBe(404);
    await page.goto('/about');
    await expect(page.getByRole('img', { name: 'Architecture' })).toBeVisible();
    await expect(page.locator('#win-rates-and-confidence-intervals')).toBeVisible();
    await expect(page.locator('#methodology')).toHaveText('Methodology');
    await expect(page.getByRole('main')).toContainText('Wilson interval');
    // ids must be unique
    const dupes = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    expect(dupes).toEqual([]);
  });
});
