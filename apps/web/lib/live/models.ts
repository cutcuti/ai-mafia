import { MODELS, type ModelSpec } from '@ai-mafia/agents';

const KEY_FOR: Record<ModelSpec['provider'], string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_API_KEY',
};

/** Guests (no login) only get models at or under this output price, USD per million tokens. */
export const GUEST_MAX_OUTPUT_PER_MTOK = 2;

/** Models a visitor may put in a live game: cheap (webAllowed), enabled, and with a server-side key configured. */
export function webModels(env: Record<string, string | undefined> = process.env, opts: { guest?: boolean } = {}): { id: string; displayName: string }[] {
  const mocked = env.MAFIA_DRY_RUN === '1'; // offline dev/e2e: every web model runs on a mock provider
  return MODELS.filter(
    (m) =>
      m.enabled &&
      m.webAllowed &&
      (mocked || !!env[KEY_FOR[m.provider]]) &&
      (!opts.guest || m.pricing.outputPerMTok <= GUEST_MAX_OUTPUT_PER_MTOK),
  ).map((m) => ({ id: m.id, displayName: m.displayName }));
}
