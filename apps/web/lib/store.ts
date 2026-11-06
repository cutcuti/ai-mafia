import 'server-only';
import { FixtureStore } from './fixture-store';
import { LiveAwareStore } from './live-aware-store';
import { getMemoryLiveStore } from './live/live-store';
import { SupabaseStore } from './supabase-store';
import type { GameStore } from './types';

let store: GameStore | undefined;

/**
 * The server's game store. MAFIA_FIXTURE_DIR (local dev / Playwright) serves bench JSON files plus in-memory live
 * games; otherwise Supabase with the service role. Never reachable from client code ('server-only').
 */
export function getStore(): GameStore {
  if (!store) {
    const dir = process.env.MAFIA_FIXTURE_DIR;
    if (dir) {
      const mem = getMemoryLiveStore();
      store = mem ? new LiveAwareStore(FixtureStore.fromDir(dir), mem) : FixtureStore.fromDir(dir);
    } else store = SupabaseStore.fromEnv();
  }
  return store;
}
