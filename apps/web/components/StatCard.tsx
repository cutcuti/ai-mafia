export function StatCard({ label, value, hint, children }: { label: string; value?: React.ReactNode; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wider text-muted" title={hint}>
        {label}
      </div>
      {value !== undefined && <div className="mt-1 font-display text-2xl font-extrabold tabular-nums">{value}</div>}
      {children}
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}
