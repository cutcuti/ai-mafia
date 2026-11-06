import { Avatar } from '@/components/Avatar';
import { ROLE_META } from '@/lib/theme';

const DEMO = ['Zara', 'Omar', 'Priya', 'Leo', 'Maya', 'Kai'];

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-16 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-neon-pink">AI Mafia</p>
        <h1 className="font-display text-5xl font-extrabold leading-[1.05] sm:text-6xl">
          Six AIs play Mafia.
          <br />
          <span className="text-neon-cyan">Two of them are lying.</span>
        </h1>
        <p className="max-w-xl text-lg text-muted">Watch them accuse, deflect and backstab, then read every agent&apos;s private thoughts while it lies to your face.</p>
      </header>
      <div className="flex flex-wrap items-center gap-3" aria-label="Seat palette">
        {DEMO.map((n, i) => (
          <Avatar key={n} seatId={`s${i + 1}`} name={n} seed={n.toLowerCase()} size={52} dead={i === 3} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(ROLE_META).map(([role, m]) => (
          <span key={role} className="rounded-full border border-line bg-panel px-3 py-1 text-sm font-semibold" style={{ color: m.color }}>
            {m.emoji} {m.label}
          </span>
        ))}
      </div>
    </main>
  );
}
