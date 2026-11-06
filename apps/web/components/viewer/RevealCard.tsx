'use client';

import { motion, useReducedMotion } from 'motion/react';
import { ROLE_META } from '@/lib/theme';
import type { Role } from '@ai-mafia/engine';

/** Card flip from ❓ to the role (BRD §10.3 "role reveal moments"). Static under reduced motion. */
export function RevealCard({ role, size = 56 }: { role: Role; size?: number }) {
  const reduce = useReducedMotion();
  const m = ROLE_META[role];
  const face = 'absolute inset-0 grid place-items-center rounded-xl border text-2xl [backface-visibility:hidden]';
  return (
    <div style={{ width: size, height: size * 1.3, perspective: 600 }} aria-label={`Role: ${m.label}`} role="img">
      <motion.div
        className="relative h-full w-full [transform-style:preserve-3d]"
        initial={reduce ? false : { rotateY: 180 }}
        animate={{ rotateY: 0 }}
        transition={{ duration: 0.7, delay: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className={face} style={{ borderColor: m.color, background: `color-mix(in oklab, ${m.color} 16%, var(--color-panel))` }}>
          <span aria-hidden>{m.emoji}</span>
        </div>
        <div className={`${face} border-line bg-panel-2 text-muted [transform:rotateY(180deg)]`}>
          <span aria-hidden>❓</span>
        </div>
      </motion.div>
    </div>
  );
}
