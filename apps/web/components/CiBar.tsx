import { pct } from '@/lib/format';
import type { Interval } from '@/lib/stats';

/** 0–100% track with the Wilson interval as a band and the point estimate as a dot. Wide band = we don't know yet. */
export function CiBar({ i, color = 'var(--color-neon-cyan)', width = 120 }: { i: Interval; color?: string; width?: number }) {
  if (!i || i.n === 0 || !Number.isFinite(i.p)) return <span className="text-faint">—</span>;
  const x = (v: number) => 4 + v * (width - 8);
  return (
    <div className="flex items-center gap-2">
      <svg width={width} height={14} role="img" aria-label={`${pct(i.p)}, 95% interval ${pct(i.lo)} to ${pct(i.hi)}, ${i.n} games`}>
        <line x1={4} x2={width - 4} y1={7} y2={7} stroke="var(--color-line)" strokeWidth={2} strokeLinecap="round" />
        <line x1={x(0.5)} x2={x(0.5)} y1={3} y2={11} stroke="var(--color-faint)" strokeWidth={1} />
        <line x1={x(i.lo)} x2={x(i.hi)} y1={7} y2={7} stroke={color} strokeOpacity={0.45} strokeWidth={6} strokeLinecap="round" />
        <circle cx={x(i.p)} cy={7} r={4} fill={color} />
      </svg>
      <span className="whitespace-nowrap tabular-nums">
        {pct(i.p)}
        <span className="ml-1 text-xs text-muted">
          ±{pct(Math.max(i.p - i.lo, i.hi - i.p))}
        </span>
      </span>
    </div>
  );
}
