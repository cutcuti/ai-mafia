import { expect, test } from '@playwright/test';

const GAME = '/g/demo-s1';

test.describe('replay viewer', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop flow');

  test('home lists the game and opens the viewer, which plays', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Recent games' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Watch the whole game/ })).toBeVisible(); // M8 featured replay
    await page.getByRole('region', { name: 'Recent games' }).getByRole('link', { name: /Claude Haiku/ }).first().click();
    await expect(page).toHaveURL(/\/g\//);
    await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible(); // auto-plays
    await expect(page.getByText('Night 1', { exact: false }).first()).toBeVisible();
  });

  test('open replay → toggle spectator mode → scrub timeline', async ({ page }) => {
    await page.goto(`${GAME}?t=30`);
    // deep link opens paused
    await expect(page.getByRole('button', { name: /Play/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Reveal private thought/ })).toHaveCount(0);

    // spectator mode: thoughts appear as spoilers, true roles appear on the rail
    const toggle = page.getByRole('switch', { name: /Spectator/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const thought = page.getByRole('button', { name: 'Reveal private thought' }).first();
    await expect(thought).toBeVisible();
    await thought.click();
    await expect(page.getByRole('button', { name: 'Private thought' }).first()).toBeVisible();
    await expect(page.getByText('🔒 mafia channel').first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Players' }).getByText('Mafia').first()).toBeVisible();

    // scrub to the end → game over, results dialog
    const slider = page.getByRole('slider', { name: 'Timeline' });
    await slider.focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('dialog', { name: /wins|Draw/ })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'The awards' })).toBeVisible(); // M8 judge awards
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // scrub back to the start
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(page.getByText(/^0\/\d+$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reveal private thought' })).toHaveCount(0);
  });

  test('keyboard: space pauses/plays, arrows step', async ({ page }) => {
    await page.goto(`${GAME}?t=20`);
    const counter = page.getByText(/^\d+\/\d+$/);
    const before = await counter.textContent();
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const after = await counter.textContent();
    expect(Number(after!.split('/')[0])).toBe(Number(before!.split('/')[0]) + 2);
    await page.keyboard.press(' ');
    await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();
  });

  test('I3: the server-rendered page carries no private thoughts or hidden events', async ({ request }) => {
    const html = await (await request.get(GAME)).text();
    expect(html).not.toContain('thought\\"');
    expect(html).not.toContain('mafia_chat');
    expect(html).not.toContain('investigate_result');
    const spec = await (await request.get('/api/games/demo-s1/events?view=spectator')).json();
    expect(spec.events.some((e: { type: string }) => e.type === 'thought')).toBe(true); // they exist — just not in the page
  });
});
