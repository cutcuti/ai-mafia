import 'server-only';
import { fixtureMode } from '../devmode';
import { MemoryLiveStore } from './memory-store';
import { SupabaseLiveStore } from './supabase-live-store';
import type { LiveStore } from './types';

// One process-wide instance, shared by pages and API routes. Next bundles those into separate module layers, so
// the MemoryLiveStore *class* can exist twice — never use `instanceof` on this object; use the flag below.
const g = globalThis as unknown as { __mafiaLiveStore?: LiveStore; __mafiaLiveStoreIsMemory?: boolean };

/** Supabase in prod; an in-memory store in fixture mode (local dev / Playwright without a database). */
export function getLiveStore(): LiveStore {
  if (!g.__mafiaLiveStore) {
    g.__mafiaLiveStoreIsMemory = fixtureMode();
    g.__mafiaLiveStore = fixtureMode() ? new MemoryLiveStore() : SupabaseLiveStore.fromEnv();
  }
  return g.__mafiaLiveStore;
}

export function getMemoryLiveStore(): MemoryLiveStore | null {
  const s = getLiveStore();
  return g.__mafiaLiveStoreIsMemory ? (s as MemoryLiveStore) : null;
}
