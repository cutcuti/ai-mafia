/**
 * Offline dev/test mode: MAFIA_FIXTURE_DIR serves bench JSON + in-memory live games instead of Supabase, and
 * MAFIA_DEV_USER=1 signs everyone in as a fake local user, with mocked models (no API keys, no cost).
 * Never active in production: it requires the fixture store, and a Supabase-backed deployment doesn't set it.
 */
export const fixtureMode = () => !!process.env.MAFIA_FIXTURE_DIR;
export const devUserMode = () => fixtureMode() && process.env.MAFIA_DEV_USER === '1' && process.env.VERCEL !== '1';
