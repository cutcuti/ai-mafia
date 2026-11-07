import { storedFromLive } from './live/advance';
import type { MemoryLiveStore } from './live/memory-store';
import type { GameStore, ListQuery } from './types';

/** Fixture mode: bench JSON games plus in-memory live games, behind one GameStore (so /g/[id] works for both). */
export class LiveAwareStore implements GameStore {
  constructor(
    private readonly base: GameStore,
    private readonly live: MemoryLiveStore,
  ) {}

  listGames(q: ListQuery) {
    return this.base.listGames(q);
  }
  async getGame(id: string) {
    const g = await this.live.loadLive(id);
    return g ? storedFromLive(g) : this.base.getGame(id);
  }
  async getEvents(id: string) {
    const g = await this.live.loadLive(id);
    return g ? g.state.events : this.base.getEvents(id);
  }
  getLeaderboard() {
    return this.base.getLeaderboard();
  }
  listPairGames() {
    return this.base.listPairGames();
  }
  async getHighlights(id: string) {
    return (await this.live.loadLive(id)) ? this.live.highlightsOf(id) : this.base.getHighlights(id);
  }
  modelMoments(modelId: string, limit: number) {
    return this.base.modelMoments(modelId, limit);
  }
}
