import { expect, test } from '@playwright/test';

test.describe('live AI games (offline: mocked models, in-memory store)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop flow');

  test('M6 done-when: start a game from /play and watch it live to the end', async ({ page }) => {
    await page.goto('/play');
    await expect(page.getByText(/Signed in as/)).toBeVisible();
    await page.getByText('Classic').click();
    await page.getByRole('button', { name: /Start live game/ }).click();

    await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel('Live game')).toBeVisible(); // LIVE badge
    // the game advances while we watch: new public messages arrive
    await expect(page.locator('[data-seq]').first()).toBeVisible({ timeout: 20_000 });

    // spectator mode works on a live AI-only game
    await page.getByRole('switch', { name: /Spectator/ }).click();
    await expect(page.getByRole('switch', { name: /Spectator/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Reveal private thought' }).first()).toBeVisible({ timeout: 20_000 });

    // fast-forward: instant speed keeps the playhead caught up, so the browser drives the game to the end
    await page.getByRole('radio', { name: 'instant' }).click();
    await expect(page.getByRole('dialog', { name: /wins|Draw/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel('Live game')).toHaveCount(0);
  });

  test('admin sees today’s spend and running games, and can abort one', async ({ page, request }) => {
    const { id } = await (await request.post('/api/games', { data: { preset: 'classic6', models: ['claude-haiku'] } })).json();
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
    await expect(page.getByText('Spent today (UTC)')).toBeVisible();
    const row = page.getByRole('row').filter({ has: page.locator(`a[href="/g/${id}"]`) });
    await expect(row).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: 'Abort' }).click();
    await expect(page.locator(`a[href="/g/${id}"]`)).toHaveCount(0);
    const adv = await (await request.post(`/api/games/${id}/advance`)).json();
    expect(adv.status).toBe('aborted');
    await page.goto(`/g/${id}`);
    await expect(page.getByText(/This game was stopped/)).toBeVisible();
  });

  test('advance on a finished replay game is refused (not a live game)', async ({ request }) => {
    const r = await request.post('/api/games/demo-s1/advance');
    expect([404, 409]).toContain(r.status());
  });

  test('creating a game validates input', async ({ request }) => {
    const bad = await request.post('/api/games', { data: { preset: 'classic6', models: ['claude-opus'] } });
    expect(bad.status()).toBe(400);
    const ok = await request.post('/api/games', { data: { preset: 'mini5', models: ['claude-haiku'] } });
    expect(ok.status()).toBe(201);
    const { id } = await ok.json();
    const meta = await (await request.get(`/api/games/${id}`)).json();
    expect(meta.status).toBe('running');
    expect(meta.seats.every((s: Record<string, unknown>) => s.role === undefined && s.modelId === undefined)).toBe(true);
  });
});
