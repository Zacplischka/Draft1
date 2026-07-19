/** Shared progress bar (issue #29): width changes animate, motion-safe. */
export function ProgressBar({
  pct,
  className = 'mt-3 h-2',
  color = 'bg-green-500',
}: {
  pct: number;
  className?: string;
  color?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-full bg-slate-200 ${className}`}>
      <div
        className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
