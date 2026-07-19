import { useEffect, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { SUPPRESSION_N, type HostReport } from '../shared/contract';
import { formatDate, workflowLabel } from './dashboard';
import { btnPrimary, btnSecondary, tabIdle } from './button';
import { ErrorText } from './Announce';
import {
  DIMENSIONS,
  cellTone,
  consensus,
  consensusLabel,
  downloadReportCsv,
  fetchReport,
  orderCohorts,
  type Consensus,
  type DimensionKey,
} from './host-report';

const BADGE: Record<Consensus, string> = {
  strong: 'bg-green-100 text-green-700',
  mixed: 'bg-amber-100 text-amber-700',
  polarised: 'bg-indigo-100 text-indigo-700',
};
const BAR: Record<Consensus, string> = {
  strong: 'bg-green-500',
  mixed: 'bg-amber-400',
  polarised: 'bg-indigo-500',
};
const CELL: Record<ReturnType<typeof cellTone>, string> = {
  high: 'bg-green-100 text-green-800',
  mid: 'bg-amber-100 text-amber-800',
  low: 'bg-red-100 text-red-800',
};

/** One spread row: rank, text, avg badge, p25–bar–p75, consensus badge (mock 11). */
function SpreadRow({ index, s }: { index: number; s: HostReport['solutions'][number] }) {
  const c = s.p25 !== null && s.p75 !== null ? consensus(s.p25, s.p75) : null;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
      <span className="shrink-0 text-lg font-bold text-indigo-600">#{index + 1}</span>
      <p className="min-w-0 flex-1 basis-40 font-medium text-slate-900">{s.text}</p>
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 bg-white font-semibold ${
          index === 0 ? 'border-green-500 text-green-600' : 'border-indigo-500 text-indigo-600'
        }`}
      >
        {s.avg ?? '—'}
      </span>
      <div className="flex min-w-0 flex-1 basis-52 items-center gap-2">
        <span className="w-8 shrink-0 text-right text-sm tabular-nums text-slate-700">{s.p25 ?? '—'}</span>
        <div className="relative h-1.5 min-w-16 flex-1 rounded-full bg-slate-200">
          {c !== null && (
            <div
              className={`absolute inset-y-0 rounded-full ${BAR[c]}`}
              style={{ left: `${s.p25}%`, width: `${Math.max(s.p75! - s.p25!, 1)}%` }}
            />
          )}
        </div>
        <span className="w-8 shrink-0 text-sm tabular-nums text-slate-700">{s.p75 ?? '—'}</span>
      </div>
      <span
        className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium ${
          c === null ? 'text-slate-400' : BADGE[c]
        }`}
      >
        {c === null ? '—' : consensusLabel[c]}
      </span>
    </li>
  );
}

/** Mock 11 — the host-only Report: spread overview, demographic heatmap, CSV export.
 *  Reached only from host surfaces (Ranked-list host panel, dashboard, history). */
export function Report({
  sessionId,
  backLabel,
  onBack,
}: {
  sessionId: string;
  backLabel: string;
  onBack: () => void;
}) {
  const [report, setReport] = useState<HostReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [epoch, setEpoch] = useState(0); // bumped by Try again
  const [dim, setDim] = useState<DimensionKey>('department');
  const [csvError, setCsvError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setFailed(false);
    fetchReport(sessionId).then(
      (r) => {
        if (!disposed) setReport(r);
      },
      () => {
        if (!disposed) setFailed(true);
      },
    );
    return () => {
      disposed = true;
    };
  }, [sessionId, epoch]);

  if (!report) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 p-6">
        {failed ? (
          <>
            <p className="text-slate-500">Could not load the report.</p>
            <button
              onClick={() => setEpoch((n) => n + 1)}
              className={`${btnPrimary} rounded-lg px-6 py-2.5`}
            >
              Try again
            </button>
          </>
        ) : (
          <p className="text-slate-400">Loading report…</p>
        )}
        <button
          onClick={onBack}
          className={`${btnSecondary} rounded-lg border-indigo-300 px-5 py-2.5`}
        >
          <ArrowLeft className="inline h-4 w-4" aria-hidden /> {backLabel}
        </button>
      </div>
    );
  }

  const cohorts = report.heatmap[dim] ?? {};
  const cols = orderCohorts(dim, Object.keys(cohorts));

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
      </header>
      <main className="mx-auto max-w-4xl p-4 pb-10 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700">Host report</span>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onBack}
              className={`${btnSecondary} rounded-lg border-indigo-300 px-4 py-2`}
            >
              <ArrowLeft className="inline h-4 w-4" aria-hidden /> {backLabel}
            </button>
            <button
              onClick={() =>
                void downloadReportCsv(sessionId).then(
                  () => setCsvError(null),
                  () => setCsvError('Could not export the CSV. Please try again.'),
                )
              }
              className={`${btnPrimary} rounded-lg px-4 py-2`}
            >
              <Download className="inline h-4 w-4" aria-hidden /> Export CSV
            </button>
          </div>
        </div>
        {csvError && <ErrorText className="mt-2 text-right">{csvError}</ErrorText>}

        <h1 className="mt-4 text-2xl font-semibold text-slate-900">{report.session.problem}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span>
            {workflowLabel(report.session.workflow)} · {report.session.participants} Participants · Completed{' '}
            {formatDate(report.session.closedAt)}
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">
            <span aria-hidden>🔒</span> Suppression on · minimum cohort {SUPPRESSION_N}
          </span>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Average confidence and spread</h2>
            <p className="text-sm text-slate-500">Spread shows the middle 50% of complete ballots.</p>
          </div>
          <ul className="mt-2 divide-y divide-slate-100">
            {report.solutions.map((s, i) => (
              <SpreadRow key={s.id} index={i} s={s} />
            ))}
          </ul>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Confidence by {DIMENSIONS.find((d) => d.key === dim)!.label}
            </h2>
            <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
              {DIMENSIONS.map((d) => (
                <button
                  key={d.key}
                  onClick={() => setDim(d.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    dim === d.key ? 'bg-indigo-100 text-indigo-700' : tabIdle
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {cols.length === 0 ? (
            <p className="py-10 text-center text-slate-500">
              No demographic breakdown — this Session closed with no ballots.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[28rem] border-separate border-spacing-1 text-sm">
                <thead>
                  <tr>
                    <th className="min-w-36 px-2 py-2 text-left font-medium text-slate-500">Solution</th>
                    {cols.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-2 text-center font-medium text-slate-700">
                        {c} <span className="font-normal text-slate-400">({cohorts[c]!.n})</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.solutions.map((s) => (
                    <tr key={s.id}>
                      <td className="px-2 py-3 font-medium text-slate-900">{s.text}</td>
                      {cols.map((c) => {
                        const v = cohorts[c]!.cells[s.id];
                        return typeof v === 'number' ? (
                          <td key={c} className={`rounded-md px-2 py-3 text-center font-semibold ${CELL[cellTone(v)]}`}>
                            {v}
                          </td>
                        ) : (
                          <td key={c} className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-3 text-center text-slate-500">
                            <span aria-hidden>🔒</span> Too few to display
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-500">
                <span aria-hidden>🔒</span> Cells with fewer than {SUPPRESSION_N} Participants are suppressed.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
