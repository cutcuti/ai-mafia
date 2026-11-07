import Link from 'next/link';
import { MobileMenu } from './MobileMenu';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { href: '/', label: 'Games' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/play', label: 'Play live' },
  { href: '/about', label: 'About' },
];

export function SiteHeader({ active }: { active?: string }) {
  return (
    <header className="relative border-b-[3px] border-shadow bg-panel">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3 sm:px-6">
        <Link href="/" className="mr-4 flex shrink-0 items-center gap-2 font-display text-lg">
          <span aria-hidden className="grid h-6 w-6 place-items-center border-2 border-shadow bg-neon-pink text-[0.7rem] text-[var(--color-shadow)]">
            ♦
          </span>
          <span>
            AI <span className="text-neon-pink">Mafia</span>
          </span>
        </Link>

        {/* tablets and up: the full bar */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active === n.href ? 'page' : undefined}
              className={`shrink-0 px-3 py-1.5 font-display text-[0.6rem] uppercase ${active === n.href ? 'text-neon-amber' : 'text-muted hover:text-fg'}`}
            >
              {active === n.href && <span aria-hidden>▸</span>}
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-4">
          <a href="https://github.com/cutcuti/ai-mafia" className="hidden font-display text-[0.6rem] text-muted hover:text-fg md:inline" rel="noopener noreferrer">
            GitHub ↗
          </a>
          <ThemeToggle />
          {/* phones: a menu button */}
          <MobileMenu items={NAV} active={active} />
        </div>
      </div>
    </header>
  );
}
