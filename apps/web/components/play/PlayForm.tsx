'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const PRESETS = [
  { id: 'classic6', label: 'Classic', sub: '6 players · 2 mafia' },
  { id: 'mini5', label: 'Mini', sub: '5 players · 1 mafia' },
  { id: 'big8', label: 'Big', sub: '8 players · 2 mafia' },
];

/** Lobby: pick a table and 1–3 models (each seat draws one at random), then start. gamesLeft null = unknown (guests). */
export function PlayForm({ models, gamesLeft }: { models: { id: string; displayName: string }[]; gamesLeft: number | null }) {
  const router = useRouter();
  const [preset, setPreset] = useState('classic6');
  const [picked, setPicked] = useState<string[]>(models.slice(0, 1).map((m) => m.id));
  const [busy, setBusy] = useState(false);
  const [human, setHuman] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset, models: picked, humanSeat: human }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not start a game.');
      router.push(`/g/${body.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Table</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRESETS.map((p) => (
            <label key={p.id} className={`cursor-pointer rounded-2xl border p-3 ${preset === p.id ? 'border-neon-cyan bg-neon-cyan/10' : 'border-line bg-panel'}`}>
              <input type="radio" name="preset" value={p.id} checked={preset === p.id} onChange={() => setPreset(p.id)} className="sr-only" />
              <div className="font-semibold">{p.label}</div>
              <div className="text-sm text-muted">{p.sub}</div>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Models (pick 1–3)</legend>
        {models.length === 0 ? (
          <p className="text-muted">No models are available for live games right now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {models.map((m) => (
              <label key={m.id} className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold ${picked.includes(m.id) ? 'border-neon-pink bg-neon-pink/15 text-neon-pink' : 'border-line text-muted'}`}>
                <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} className="sr-only" />
                {m.displayName}
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Each seat gets one of the picked models at random. With one model, it plays itself.</p>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-panel p-3">
        <input type="checkbox" checked={human} onChange={(e) => setHuman(e.target.checked)} className="mt-1 accent-[var(--color-neon-cyan)]" />
        <span>
          <span className="font-semibold">Play yourself</span>
          <span className="block text-sm text-muted">Take one seat against the AIs. They don&apos;t know which one is you. Thoughts stay hidden until the game ends.</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || picked.length === 0 || (gamesLeft !== null && gamesLeft <= 0)} className="btn btn-go">
          {busy ? 'Starting…' : 'Start live game →'}
        </button>
        <span className="text-sm text-muted">{gamesLeft === null ? '' : gamesLeft > 0 ? `${gamesLeft} left today` : 'Daily limit reached'}</span>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-mafia/40 bg-mafia/10 px-3 py-2 text-sm text-mafia">
          {error}
        </p>
      )}
    </form>
  );
}
