'use client';

import { useEffect, useState } from 'react';

const KEY = 'ai-mafia:theme';

/** Runs before paint (inlined in <head>) so a saved dark choice never flashes light. */
export const THEME_BOOT = `try{if(localStorage.getItem('${KEY}')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;

/** Light (default) ⇄ dark. Remembered per browser; light if storage is unavailable. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(KEY, next ? 'dark' : 'light');
    } catch {
      // private mode: works for this page only
    }
  };
  return (
    <button type="button" onClick={flip} className="btn btn-sm shrink-0" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-pressed={dark}>
      <span aria-hidden>{dark ? '☀️' : '🌙'}</span>
    </button>
  );
}
