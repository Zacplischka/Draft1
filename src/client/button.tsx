import type { ButtonHTMLAttributes } from 'react';

// Shared button styles (issue #26): interaction states only. Size, spacing,
// rounding, and border shade stay at each call site. Cursor, focus ring, and
// motion-safe transitions come from base rules in index.css.
export const btnPrimary =
  'bg-indigo-600 font-medium text-white hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-slate-300';
export const btnDanger =
  'bg-red-600 font-medium text-white hover:bg-red-700 active:bg-red-800 disabled:bg-slate-300';
export const btnSecondary =
  'border font-medium text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 disabled:border-slate-300 disabled:text-slate-400';
export const btnNeutral =
  'border border-slate-300 font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100';
export const btnDangerOutline =
  'border border-red-300 font-medium text-red-600 hover:bg-red-50 active:bg-red-100 disabled:opacity-50';
export const btnLink = 'font-medium text-indigo-600 hover:text-indigo-700 active:text-indigo-800';
export const btnGhost =
  'text-slate-400 hover:text-slate-600 active:text-slate-700 disabled:text-slate-300';
export const btnGhostDanger =
  'text-slate-400 hover:text-red-600 active:text-red-700 disabled:text-slate-300';
export const menuItem =
  'block w-full px-4 py-2 text-left text-sm hover:bg-slate-50 active:bg-slate-100';
export const tabIdle = 'text-slate-600 hover:text-slate-900 active:text-slate-900';

/** Inherits text color via border-current; pass sizing classes to override the default. */
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none ${className}`}
    />
  );
}

/** Button that shows spinner + busy label + aria-busy while its action's ack is pending (issue #30). */
export function BusyButton({
  busy,
  busyLabel,
  disabled,
  children,
  ...rest
}: { busy: boolean; busyLabel: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Spinner /> {busyLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
