import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;

/**
 * Smoke tests against a production build serving a committed fixture game (no Supabase, no keys).
 * MAFIA_FIXTURE_DIR swaps the store; NEXT_DIST_DIR keeps this build apart from `next dev`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `next build && next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    // offline: fixture games, in-memory live games, a fake local user, mocked models (no keys, no cost)
    env: {
      MAFIA_FIXTURE_DIR: 'e2e/fixtures',
      MAFIA_DEV_USER: '1',
      MAFIA_DRY_RUN: '1',
      ADMIN_GITHUB_IDS: 'dev',
      MAX_LIVE_GAMES_PER_USER_PER_DAY: '50',
      CREATE_PER_USER_PER_HOUR: '100',
      CREATE_PER_IP_PER_HOUR: '100',
      NEXT_DIST_DIR: '.next-e2e',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
