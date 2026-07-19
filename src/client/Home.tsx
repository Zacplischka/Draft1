import { useState, type MouseEvent } from 'react';
import type { ErrorCode } from '../shared/contract';
import { btnPrimary, btnSecondary, btnLink, btnGhost, menuItem, tabIdle } from './button';
import {
  activeSession,
  formatDate,
  formatTime,
  greetingFor,
  phaseLabel,
  recentSessions,
  useSessions,
  workflowLabel,
} from './dashboard';

/** Shared top bar (mock 02): logo → home, Sessions tab → history, account menu. */
export function AppHeader({
  displayName,
  tab,
  onHome,
  onSessions,
  onEditProfile,
  onSignOut,
}: {
  displayName: string;
  tab: 'home' | 'sessions';
  onHome: () => void;
  onSessions: () => void;
  onEditProfile: () => void;
  onSignOut: () => void;
}) {
  // Native <details> dropdown; close it when a menu item is picked.
  const closeMenu = (e: MouseEvent) => e.currentTarget.closest('details')?.removeAttribute('open');
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <button onClick={onHome} className="font-semibold text-slate-900">
        🗳️ Group Decision
      </button>
      <div className="flex items-center gap-5">
        <button
          onClick={onSessions}
          className={`border-b-2 pb-0.5 text-sm font-medium ${
            tab === 'sessions'
              ? 'border-indigo-600 text-indigo-600'
              : `border-transparent ${tabIdle}`
          }`}
        >
          Sessions
        </button>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-full bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-800">
            {displayName}
          </summary>
          <div className="absolute right-0 z-10 mt-2 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <button
              onClick={(e) => {
                closeMenu(e);
                onEditProfile();
              }}
              className={`${menuItem} text-slate-700`}
            >
              Edit profile
            </button>
            <button
              onClick={(e) => {
                closeMenu(e);
                onSignOut();
              }}
              className={`${menuItem} text-red-600`}
            >
              Sign out
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}

/** Mock 02 host home — greeting, Create/Join, Active-session card, Recent sessions.
 *  Data from GET /api/sessions; refreshed on focus/interval (no socket push here). */
export function Home({
  displayName,
  onCreate,
  onJoin,
  onEditProfile,
  onSignOut,
  onOpenSession,
  onOpenReport,
  onOpenHistory,
}: {
  displayName: string;
  onCreate: () => void;
  onJoin: () => void;
  onEditProfile: () => void;
  onSignOut: () => void;
  onOpenSession: (sessionId: string) => Promise<ErrorCode | null>; // resolves the ack error on failure
  onOpenReport: (sessionId: string) => void;
  onOpenHistory: () => void;
}) {
  const { sessions, error } = useSessions();
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const active = activeSession(sessions ?? []);
  const recent = recentSessions(sessions ?? []);

  function copyJoinCode(code: string) {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {}); // clipboard permission denied — nothing to recover
  }

  async function open(sessionId: string) {
    setOpenError(null);
    const err = await onOpenSession(sessionId);
    if (err) setOpenError(`Could not open the session (${err}). Please try again.`);
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <AppHeader
        displayName={displayName}
        tab="home"
        onHome={() => {}}
        onSessions={onOpenHistory}
        onEditProfile={onEditProfile}
        onSignOut={onSignOut}
      />
      <main className="mx-auto max-w-2xl p-4 pb-10 sm:p-6">
        <h1 className="mt-4 text-3xl font-semibold text-slate-900">
          {greetingFor(new Date().getHours())}, {displayName.split(' ')[0]}
        </h1>
        <p className="mt-1 text-slate-500">Run a new Session or jump back into an active one.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <button
            onClick={onCreate}
            className={`${btnPrimary} rounded-xl px-6 py-4`}
          >
            + Create session
          </button>
          <button
            onClick={onJoin}
            className={`${btnSecondary} rounded-xl border-indigo-600 bg-white px-6 py-4`}
          >
            👥 Join session
          </button>
        </div>

        {openError && <p className="mt-4 text-sm text-red-600">{openError}</p>}
        {error && !sessions && <p className="mt-4 text-sm text-red-600">Could not load your sessions. Retrying…</p>}

        {active && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">Active session</h2>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-4">
                <span
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl"
                >
                  👥
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 text-lg font-semibold text-slate-900">{active.problem}</h3>
                    {/* Participant count as of fetch — refreshed on focus/interval, no push. */}
                    <span className="whitespace-nowrap rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
                      {phaseLabel(active.phase)} · {active.participants} / {active.cap}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                    <div className="flex divide-x divide-slate-200">
                      <div className="pr-6">
                        <div className="text-sm text-slate-500">Workflow</div>
                        <div className="font-medium text-slate-900">{workflowLabel(active.workflow)}</div>
                      </div>
                      {active.joinCode && (
                        <div className="pl-6">
                          <div className="text-sm text-slate-500">Join code</div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium tracking-widest text-slate-900">{active.joinCode}</span>
                            <button
                              onClick={() => copyJoinCode(active.joinCode!)}
                              aria-label="Copy join code"
                              className={btnGhost}
                            >
                              {copied ? '✓' : '📋'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => void open(active.id)}
                      className={`${btnPrimary} rounded-lg px-6 py-2.5`}
                    >
                      Open session
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">Recent sessions</h2>
            <ul className="mt-3 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
              {recent.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-sm text-green-600"
                  >
                    ✓
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{s.problem}</p>
                    <p className="text-sm text-slate-500">
                      {formatDate(s.createdAt)} · {formatTime(s.createdAt)}
                    </p>
                  </div>
                  <div className="hidden text-sm text-slate-500 sm:block">
                    <div>{workflowLabel(s.workflow)}</div>
                    <div>
                      {s.participants} participant{s.participants === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      onClick={() => void open(s.id)}
                      className={`${btnLink} text-sm`}
                    >
                      View ranked list ›
                    </button>
                    <button
                      onClick={() => onOpenReport(s.id)}
                      className={`${btnLink} text-sm`}
                    >
                      Open report ›
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {sessions && sessions.length > 0 && (
          <div className="mt-8 text-center">
            <button onClick={onOpenHistory} className={btnLink}>
              View all Session history ›
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
