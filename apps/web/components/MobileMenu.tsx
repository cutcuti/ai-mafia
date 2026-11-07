'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export interface NavItem {
  href: string;
  label: string;
}

/** Phones: a "Menu" button that opens a full-width list under the top bar. Closes on navigation, Escape or outside tap. */
export function MobileMenu({ items, active }: { items: NavItem[]; active?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="md:hidden">
      <button type="button" className="btn btn-sm" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
        <span aria-hidden>{open ? '✕' : '☰'}</span> Menu
      </button>
      {open && (
        <nav id="mobile-menu" aria-label="Main" className="absolute inset-x-0 top-full z-50 border-b-[3px] border-shadow bg-panel shadow-[0_6px_0_0_var(--color-shadow)]">
          <ul className="mx-auto flex max-w-5xl flex-col px-4 py-2">
            {items.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active === n.href ? 'page' : undefined}
                  className={`flex items-center gap-2 border-b border-line/30 py-3.5 font-display text-[0.7rem] uppercase ${active === n.href ? 'text-neon-amber' : 'text-fg'}`}
                >
                  <span aria-hidden className="w-3">{active === n.href ? '▸' : ''}</span>
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <a href="https://github.com/cutcuti/ai-mafia" rel="noopener noreferrer" className="flex items-center gap-2 py-3.5 font-display text-[0.7rem] uppercase text-muted">
                <span aria-hidden className="w-3" />
                GitHub ↗
              </a>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
