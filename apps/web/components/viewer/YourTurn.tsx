'use client';

import { useEffect, useRef, useState } from 'react';
import type { InputRequest } from '@ai-mafia/engine';
import type { RosterSeat } from '@/lib/roster';
import { seatColor } from '@/lib/theme';

const TURN_SECONDS = 90;
const PROMPT: Record<string, string> = {
  kill: '🔪 Who should the mafia kill tonight?',
  save: '💉 Who do you protect tonight?',
  investigate: '🔍 Who do you investigate tonight?',
  vote: '🗳️ Who do you vote to eliminate?',
};

/**
 * The human seat's move (BRD §10.4): chat box (280 chars, live counter) or target cards, with a 90s timer.
 * On timeout it submits a random valid choice / a quiet line — the same "never stall the table" rule as I5.
 */
export function YourTurn({ req, seats, onSubmit }: { req: InputRequest; seats: Map<string, RosterSeat>; onSubmit: (body: Record<string, unknown>) => Promise<string | null> }) {
  const [text, setText] = useState('');
  const [left, setLeft] = useState(TURN_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);

  const send = async (body: Record<string, unknown>) => {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    const err = await onSubmit({ requestId: req.id, ...body });
    if (err) {
      sent.current = false;
      setError(err);
      setBusy(false);
    }
  };

  useEffect(() => {
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left > 0) return;
    if (req.kind === 'choose') void send({ target: req.options[Math.floor(Math.random() * req.options.length)] });
    else if (req.kind === 'speak') void send({ speech: '…' });
    else void send({ notes: '(no notes)' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const max = req.kind === 'speak' ? req.maxChars : 2000;
  return (
    <section className="border-t-2 border-neon-cyan bg-panel px-3 py-3 sm:px-6" aria-label="Your turn" role="region">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="animate-pulse font-display text-lg font-extrabold text-neon-cyan">YOUR TURN</span>
          <span className={`tabular-nums text-sm ${left <= 15 ? 'font-bold text-mafia' : 'text-muted'}`} aria-live="polite">
            {Math.max(0, left)}s
          </span>
        </div>

        {req.kind === 'choose' ? (
          <>
            <p className="mb-2 font-semibold">{PROMPT[req.action]}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {req.options.map((id) => {
                const s = seats.get(id);
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    onClick={() => void send({ target: id })}
                    className="rounded-2xl border border-line bg-panel-2 px-3 py-3 text-left font-semibold hover:border-neon-cyan disabled:opacity-50"
                    style={{ color: seatColor(id) }}
                  >
                    {s?.name ?? id}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void send(req.kind === 'speak' ? { speech: text } : { notes: text });
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor="your-turn-text" className="font-semibold">
              {req.kind === 'notes' ? '📝 Private notes for yourself' : req.channel === 'mafia' ? '🔒 Talk to your mafia partner' : '💬 Say something to the table'}
            </label>
            <div className="flex gap-2">
              <textarea
                id="your-turn-text"
                value={text}
                maxLength={max}
                rows={2}
                autoFocus
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (text.trim()) void send(req.kind === 'speak' ? { speech: text } : { notes: text });
                  }
                }}
                className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-ink px-3 py-2"
              />
              <button type="submit" disabled={busy || !text.trim()} className="self-end rounded-full bg-neon-cyan px-4 py-2 font-semibold text-ink disabled:opacity-50">
                Send
              </button>
            </div>
            <span className={`text-right text-xs tabular-nums ${text.length > max - 20 ? 'text-neon-amber' : 'text-muted'}`}>
              {text.length}/{max}
            </span>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-mafia">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
