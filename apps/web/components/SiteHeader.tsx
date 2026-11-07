import Link from 'next/link';

const NAV = [
  { href: '/', label: 'Games' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/play', label: 'Play live' },
  { href: '/about', label: 'About' },
];

export function SiteHeader({ active }: { active?: string }) {
  return (
    <header className="border-b-[3px] border-shadow bg-panel">
      <nav className="mx-auto flex max-w-5xl items-center gap-0.5 overflow-x-auto px-4 py-3 sm:gap-1 sm:px-6" aria-label="Main">
        <Link href="/" className="mr-2 flex shrink-0 items-center gap-2 font-display text-lg sm:mr-4">
          <span aria-hidden className="grid h-6 w-6 place-items-center border-2 border-shadow bg-neon-pink text-[0.7rem] text-[var(--color-shadow)]">♦</span>
          <span>
            AI <span className="text-neon-pink">Mafia</span>
          </span>
        </Link>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active === n.href ? 'page' : undefined}
            className={`shrink-0 px-2 py-1.5 font-display text-[0.6rem] uppercase sm:px-3 ${active === n.href ? 'text-neon-amber' : 'text-muted hover:text-fg'}`}
          >
            {active === n.href && <span aria-hidden>▸</span>}
            {n.label}
          </Link>
        ))}
        <a href="https://github.com/cutcuti/ai-mafia" className="ml-auto hidden text-sm text-muted hover:text-fg sm:inline" rel="noopener noreferrer">
          GitHub ↗
        </a>
      </nav>
    </header>
  );
}
