import { useState } from 'react';
import { X } from 'lucide-react';
import type { SessionState } from '../shared/contract';
import type { Emit } from './create-session';
import { JoinCode } from './HostLobby';
import { closeVoting, initials } from './host-voting';
import { btnSecondary, btnDangerOutline, btnGhost, BusyButton } from './button';
import { ErrorText } from './Announce';
import { CancelSessionButton } from './CancelSession';

function StatCard({ icon, tint, value, label }: { icon: string; tint: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${tint}`} aria-hidden>
        {icon}
      </span>
      <div>
        <div className="text-xl font-semibold text-slate-900">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
      </div>
    </div>
  );
}

/** Mock 09 — the host's voting control: stat cards, host-only roster (names + status,
 *  never scores), and Close voting with its confirm dialog. Live via session:state. */
export function HostVotingControl({ state, emit }: { state: SessionState; emit: Emit }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = state.votingProgress ?? { voted: 0, total: 0 };
  const roster = state.roster ?? [];
  const ballots = `${progress.voted} complete ballot${progress.voted === 1 ? '' : 's'}`;

  function close() {
    setBusy(true);
    setError(null);
    closeVoting(emit)
      .then(() => setConfirming(false)) // the results snapshot routes everyone away
      .catch((err) =>
        setError(`Something went wrong (${err instanceof Error ? err.message : 'unknown'}). Please try again.`),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
      </header>
      <main className="mx-auto max-w-3xl p-4 pb-10 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700">Voting</span>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">{state.problem}</h1>
          </div>
          {state.joinCode && (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3">
              <JoinCode code={state.joinCode} />
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatCard
            icon="👤"
            tint="bg-green-100"
            value={`${progress.voted} / ${progress.total}`}
            label="voted"
          />
          <StatCard
            icon="🕐"
            tint="bg-amber-100"
            value={String(progress.total - progress.voted)}
            label="still voting"
          />
          <StatCard icon="📄" tint="bg-indigo-100" value={String(state.deck?.length ?? 0)} label="Solutions" />
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Participants</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {roster.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600"
                  >
                    {initials(r.displayName)}
                  </span>
                  <span className="truncate text-slate-900">{r.displayName}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${
                    r.voted ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {r.voted ? 'Complete' : 'Voting'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={() => setConfirming(true)}
            className={`${btnDangerOutline} rounded-lg px-5 py-2.5`}
          >
            🚫 Close voting
          </button>
          <CancelSessionButton
            emit={emit}
            className="rounded-lg border border-red-200 px-4 py-2.5"
          />
          <p className="flex-1 text-sm text-slate-500">Voting closes automatically when every Participant finishes.</p>
        </div>
        {error && <ErrorText className="mt-3">{error}</ErrorText>}
      </main>

      {confirming && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <button
              onClick={() => setConfirming(false)}
              aria-label="Close"
              className={`${btnGhost} float-right -mr-2 -mt-2`}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
            <span
              aria-hidden
              className="mx-auto mt-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl text-amber-600"
            >
              !
            </span>
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Close voting early?</h2>
            <p className="mt-2 text-slate-600">
              The Ranked list will use the {ballots} already submitted. Participants still voting won&rsquo;t be
              included.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                className={`${btnSecondary} flex-1 rounded-lg border-indigo-300 px-4 py-2.5`}
              >
                Keep voting
              </button>
              <BusyButton
                onClick={close}
                busy={busy}
                busyLabel="Closing…"
                className={`${btnDangerOutline} flex-1 rounded-lg px-4 py-2.5`}
              >
                Close voting
              </BusyButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
