/**
 * Dev tool: create an AI-only live game directly with the service role (no sign-in), then open /g/<id>.
 *   pnpm --filter @ai-mafia/web dev:live-game -- [model] [preset]
 * Server-side only — it uses SUPABASE_SERVICE_ROLE_KEY from the repo-root .env and never ships to browsers.
 */
import { createGame, isPreset, makeConfig, type Controller } from '@ai-mafia/engine';
import { SupabaseLiveStore } from '../lib/live/supabase-live-store.ts';

const [model = 'claude-haiku', preset = 'classic6'] = process.argv.slice(2).filter((a) => a !== '--');
if (!isPreset(preset)) throw new Error(`unknown preset ${preset}`);
const seed = crypto.getRandomValues(new Uint32Array(1))[0];
const probe = createGame(makeConfig({ seed, preset }));
const controllers: Controller[] = probe.seats.map(() => ({ kind: 'model', modelId: model }));
const state = createGame(makeConfig({ seed, preset, controllers, gameId: `live-${crypto.randomUUID()}`, createdAt: new Date().toISOString() }));
const id = await SupabaseLiveStore.fromEnv().createLiveGame(state, null as unknown as string);
console.log(`live game ${id} (${model}, ${preset})\nwatch: http://localhost:3100/g/${id}`);
