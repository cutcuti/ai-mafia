import Link from 'next/link';

const NAV = [
  { href: '/', label: 'Games' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/play', label: 'Play live' },
  { href: '/about', label: 'About' },
];

export function SiteHeader({ active }: { active?: string }) {
  return (
    <header className="border-b border-line/60">
      <nav className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3 sm:px-6" aria-label="Main">
        <Link href="/" className="mr-3 font-display text-lg font-extrabold tracking-tight">
          AI <span className="text-neon-pink">Mafia</span>
        </Link>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active === n.href ? 'page' : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${active === n.href ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
          >
            {n.label}
          </Link>
        ))}
        <a href="https://github.com/cutcuti/ai-mafia" className="ml-auto text-sm text-muted hover:text-fg" rel="noopener noreferrer">
          GitHub ↗
        </a>
      </nav>
    </header>
  );
}
