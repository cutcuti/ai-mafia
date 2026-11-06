import { hash, seatColor } from '@/lib/theme';

/**
 * Seeded SVG avatar: a soft blob in the seat's colour with the player's initial.
 * Deterministic from avatarSeed, no network, no dependency.
 */
export function Avatar({
  seatId,
  name,
  seed,
  size = 40,
  dead = false,
}: {
  seatId: string;
  name: string;
  seed: string;
  size?: number;
  dead?: boolean;
}) {
  const h = hash(`${seed}:${name}`);
  const color = seatColor(seatId);
  // 8-point blob, radius jitter from the hash
  const pts = Array.from({ length: 8 }, (_, i) => {
    const r = 40 + ((h >> (i * 3)) & 7);
    const a = (i / 8) * Math.PI * 2;
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)] as const;
  });
  const d =
    pts
      .map(([x, y], i) => {
        const [nx, ny] = pts[(i + 1) % pts.length];
        const mx = (x + nx) / 2;
        const my = (y + ny) / 2;
        return `${i === 0 ? `M${mx.toFixed(1)},${my.toFixed(1)}` : ''} Q${nx.toFixed(1)},${ny.toFixed(1)} ${((nx + pts[(i + 2) % pts.length][0]) / 2).toFixed(1)},${((ny + pts[(i + 2) % pts.length][1]) / 2).toFixed(1)}`;
      })
      .join(' ') + ' Z';
  const rot = h % 360;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={name}
      className={dead ? 'opacity-40 grayscale' : undefined}
      style={{ flexShrink: 0 }}
    >
      <defs>
        <radialGradient id={`g-${seatId}-${h}`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="60%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.85" />
        </radialGradient>
      </defs>
      <path d={d} fill={`url(#g-${seatId}-${h})`} transform={`rotate(${rot} 50 50)`} />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="42" fontWeight="800" fill="#0b0a12" fontFamily="var(--font-display)">
        {name.slice(0, 1).toUpperCase()}
      </text>
      {dead && <line x1="18" y1="18" x2="82" y2="82" stroke="#0b0a12" strokeWidth="6" strokeLinecap="round" />}
    </svg>
  );
}
