import { useState } from 'react';
import type { SessionState } from '../shared/contract';
import { rankedListText } from './ranked-list';
import { downloadReportCsv } from './host-report';

/** Circular average-confidence badge; "—" on null (zero-ballot close), never NaN. */
function AvgBadge({ avg, big, green }: { avg: number | null; big?: boolean; green?: boolean }) {
  const ring = green ? 'border-green-500 text-green-600' : 'border-indigo-500 text-indigo-600';
  const size = big ? 'h-16 w-16 border-4 text-2xl' : 'h-11 w-11 border-2 text-base';
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-white font-semibold ${ring} ${size}`}>
      {avg ?? '—'}
    </span>
  );
}

/** Decorative confetti dots around the winner card (mock 10). */
function Confetti() {
  const dots: [string, string, string][] = [
    ['-2%', '-12%', 'bg-indigo-500'],
    ['8%', '106%', 'bg-green-500'],
    ['24%', '-18%', 'bg-amber-400'],
    ['48%', '108%', 'bg-indigo-400'],
    ['64%', '-10%', 'bg-green-400'],
    ['82%', '110%', 'bg-amber-500'],
    ['99%', '-14%', 'bg-indigo-500'],
    ['101%', '60%', 'bg-green-500'],
    ['-1%', '55%', 'bg-amber-400'],
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {dots.map(([left, top, color], i) => (
        <span key={i} className={`absolute h-1.5 w-1.5 rounded-full ${color}`} style={{ left, top }} />
      ))}
    </div>
  );
}

/** Mock 10 — the Ranked list every member sees at results. Winner celebrated up top;
 *  the host additionally gets the "Visible only to the Host" panel. */
export function RankedList({
  state,
  onDone,
  onOpenReport,
}: {
  state: SessionState;
  onDone: () => void;
  onOpenReport: () => void;
}) {
  const ranked = state.results?.ranked ?? [];
  const [winner, ...rest] = ranked;
  const [copied, setCopied] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

  function copy() {
    navigator.clipboard
      .writeText(rankedListText(state.problem, ranked))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {}); // clipboard permission denied — nothing to recover
  }

  async function exportCsv() {
    setCsvError(null);
    try {
      await downloadReportCsv(state.sessionId);
    } catch {
      setCsvError('Could not export the CSV. Please try again.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
      </header>
      <main className="mx-auto max-w-2xl p-4 pb-10 sm:p-6">
        <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700">Ranked list</span>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <h1 className="min-w-0 text-2xl font-semibold text-slate-900">{state.problem}</h1>
          <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
            <span aria-hidden>🔒</span> Based on complete anonymous ballots. Individual Confidence scores are never
            shown.
          </p>
        </div>

        {winner && (
          <div className="relative mt-8">
            <Confetti />
            <div className="rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-white p-5 shadow-sm">
              <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                Top-ranked Solution
              </span>
              <div className="mt-4 flex items-center gap-4">
                <span className="text-3xl font-bold text-slate-900">#1</span>
                <p className="min-w-0 flex-1 text-xl font-semibold text-slate-900">{winner.text}</p>
                <div className="text-center">
                  <AvgBadge avg={winner.avg} big green />
                  <div className="mt-1 text-xs text-slate-500">Average confidence</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <ul className="mt-4 space-y-3">
          {rest.map((r, i) => (
            <li key={r.solutionId} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="shrink-0 text-xl font-bold text-slate-900">#{i + 2}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{r.text}</p>
                {r.avg !== null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-indigo-600" style={{ width: `${r.avg}%` }} />
                  </div>
                )}
              </div>
              <AvgBadge avg={r.avg} />
              <span className="hidden shrink-0 text-sm text-slate-500 sm:block">Average confidence</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            onClick={copy}
            className="rounded-lg border border-indigo-300 px-5 py-2.5 font-medium text-indigo-600 hover:bg-indigo-50"
          >
            {copied ? '✓ Copied' : '📋 Copy Ranked list'}
          </button>
          <button
            onClick={onDone}
            className="rounded-lg bg-indigo-600 px-8 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Done
          </button>
        </div>

        {state.isHost && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <span aria-hidden>🔒</span> Visible only to the Host
            </p>
            <button
              onClick={onOpenReport}
              className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700"
            >
              📊 Open Host Report
            </button>
            <button
              onClick={() => void exportCsv()}
              className="mt-3 w-full rounded-lg border border-indigo-300 px-4 py-2.5 font-medium text-indigo-600 hover:bg-indigo-50"
            >
              ⬇️ Export CSV
            </button>
            {csvError && <p className="mt-2 text-center text-sm text-red-600">{csvError}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
