import { hash, seatColor } from '@/lib/theme';

const G = 8; // sprite grid

/**
 * Seeded 8×8 pixel sprite: a little mirrored "space critter" in the seat's colour, with eyes.
 * Deterministic from avatarSeed + name, no network, no dependency.
 */
export function Avatar({ seatId, name, seed, size = 40, dead = false }: { seatId: string; name: string; seed: string; size?: number; dead?: boolean }) {
  const h = hash(`${seed}:${name}`);
  const h2 = hash(`${name}:${seed}:2`);
  const color = seatColor(seatId);
  const cells: [number, number][] = [];
  // left half (4 columns) from the hash bits, mirrored; rows 1..6, eyes on row 3
  for (let y = 1; y < G - 1; y++) {
    for (let x = 0; x < G / 2; x++) {
      const bit = ((y < 4 ? h : h2) >> ((y % 4) * 4 + x)) & 1;
      const core = x >= 2 && y >= 2 && y <= 5; // keep a solid body so every sprite reads as a face
      if (bit || core) {
        cells.push([x, y], [G - 1 - x, y]);
      }
    }
  }
  const eyes: [number, number][] = [
    [2, 3],
    [5, 3],
  ];
  const isEye = (x: number, y: number) => eyes.some(([ex, ey]) => ex === x && ey === y);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`-1 -1 ${G + 2} ${G + 2}`}
      role="img"
      aria-label={name}
      shapeRendering="crispEdges"
      className={dead ? 'opacity-40 grayscale' : undefined}
      style={{ flexShrink: 0, background: 'var(--color-shadow)', imageRendering: 'pixelated' }}
    >
      {cells.map(([x, y]) =>
        isEye(x, y) ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />,
      )}
      {eyes.map(([x, y]) => (
        <rect key={`e${x}`} x={x} y={y} width={1} height={1} fill={dead ? '#07061a' : '#fff3d6'} />
      ))}
      {dead && <path d="M1 1 L7 7 M7 1 L1 7" stroke="#ff5a5a" strokeWidth={0.9} transform="translate(0.5 0.5) scale(0.875)" />}
    </svg>
  );
}
