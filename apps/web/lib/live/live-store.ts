import 'server-only';
import { MemoryLiveStore } from './memory-store';
import { SupabaseLiveStore } from './supabase-live-store';
import type { LiveStore } from './types';

let store: LiveStore | undefined;

/** Supabase in prod; an in-memory store in fixture mode (local dev / Playwright without a database). */
export function getLiveStore(): LiveStore {
  if (!store) store = process.env.MAFIA_FIXTURE_DIR ? new MemoryLiveStore() : SupabaseLiveStore.fromEnv();
  return store;
}
