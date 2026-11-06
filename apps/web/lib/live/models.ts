import { MODELS, type ModelSpec } from '@ai-mafia/agents';

const KEY_FOR: Record<ModelSpec['provider'], string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_API_KEY',
};

/** Models a visitor may put in a live game: cheap (webAllowed), enabled, and with a server-side key configured. */
export function webModels(env: Record<string, string | undefined> = process.env): { id: string; displayName: string }[] {
  const mocked = env.MAFIA_DRY_RUN === '1'; // offline dev/e2e: every web model runs on a mock provider
  return MODELS.filter((m) => m.enabled && m.webAllowed && (mocked || !!env[KEY_FOR[m.provider]])).map((m) => ({ id: m.id, displayName: m.displayName }));
}
