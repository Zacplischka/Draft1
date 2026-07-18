import { useState } from 'react';
import { AppHeader } from './Home';
import {
  filterSessions,
  formatDate,
  formatTime,
  isLive,
  phaseLabel,
  sortSessions,
  useSessions,
  workflowLabel,
  type SortDir,
  type SortKey,
  type StateFilter,
} from './dashboard';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'problem', label: 'Problem statement' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'participants', label: 'Participants' },
  { key: 'state', label: 'State' },
];

/** Mock 02 Session history — searchable, sortable, filterable table of every hosted
 *  session. Live rows show phase + join code; completed rows link the report
 *  (CONTRACTS.md: reports exist for completed sessions only — mock's Live "Open
 *  report" is a mock error). */
export function History({
  displayName,
  onHome,
  onEditProfile,
  onSignOut,
  onCreate,
  onOpenReport,
}: {
  displayName: string;
  onHome: () => void;
  onEditProfile: () => void;
  onSignOut: () => void;
  onCreate: () => void;
  onOpenReport: (sessionId: string) => void;
}) {
  const { sessions, error } = useSessions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StateFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });

  const rows = sortSessions(filterSessions(sessions ?? [], query, filter), sort.key, sort.dir);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'date' ? 'desc' : 'asc' },
    );

  return (
    <div className="min-h-screen bg-slate-100">
      <AppHeader
        displayName={displayName}
        tab="sessions"
        onHome={onHome}
        onSessions={() => {}}
        onEditProfile={onEditProfile}
        onSignOut={onSignOut}
      />
      <main className="mx-auto max-w-4xl p-4 pb-10 sm:p-6">
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Session history</h1>
        <p className="mt-1 text-slate-500">Review past Sessions and open reports.</p>

        {sessions === null ? (
          <p className="mt-10 text-center text-slate-400">
            {error ? 'Could not load your sessions. Retrying…' : 'Loading…'}
          </p>
        ) : sessions.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm text-center">
            <div aria-hidden className="text-5xl">
              🗂️
            </div>
            <h2 className="mt-4 text-xl font-semibold text-slate-900">No sessions yet</h2>
            <p className="mt-1 text-slate-500">Once you run a Session, it will appear here.</p>
            <button
              onClick={onCreate}
              className="mt-6 w-full rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700"
            >
              Create your first session
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 sm:max-w-xs">
                <span aria-hidden className="text-slate-400">
                  🔍
                </span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Sessions"
                  className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
              </label>
              <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
                {(['all', 'live', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${
                      filter === f ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="px-4 py-3 font-medium">
                        <button
                          onClick={() => toggleSort(c.key)}
                          className="flex items-center gap-1 hover:text-slate-900"
                        >
                          {c.label}
                          {sort.key === c.key && <span aria-hidden>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((s) => {
                    const live = isLive(s);
                    return (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="text-slate-900">{formatDate(s.createdAt)}</div>
                          <div className="text-slate-500">{formatTime(s.createdAt)}</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{s.problem}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{workflowLabel(s.workflow)}</td>
                        <td className="px-4 py-3 text-slate-700">{s.participants}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {live ? (
                            <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-700">
                              ● Live
                            </span>
                          ) : (
                            <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-700">
                              ✓ Completed
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {live ? (
                            <span className="text-slate-500">
                              {phaseLabel(s.phase)} · <span className="tracking-widest">{s.joinCode}</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => onOpenReport(s.id)}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Open report ›
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No Sessions match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-center text-sm text-slate-500">
              Showing {rows.length} of {sessions.length} Sessions
            </p>
          </>
        )}
      </main>
    </div>
  );
}
