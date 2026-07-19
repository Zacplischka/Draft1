import { useState } from 'react';
import { SOLUTION_MAX_LENGTH, type SessionState } from '../shared/contract';
import type { Emit } from './create-session';
import { percentComplete, submitSolution } from './submit-solution';
import { addSolution, beginCuration, deleteSolution, editSolution, hostSteps, startVoting } from './host-lobby';
import { btnPrimary, btnSecondary, btnLink, btnGhost, btnGhostDanger } from './button';
import { ErrorText, LiveStatus } from './Announce';
import { ProgressBar } from './ProgressBar';
import { CopyButton } from './CopyButton';

export function JoinCode({ code }: { code: string }) {
  return (
    <div>
      <div className="text-sm text-slate-500">Join code</div>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-semibold tracking-widest text-slate-900">
          {code.slice(0, 3)} {code.slice(3)}
        </span>
        <CopyButton
          text={code}
          label="📋 Copy"
          ariaLabel="Copy join code"
          className={`${btnGhost} rounded border border-slate-200 px-2 py-0.5 text-sm`}
        />
      </div>
    </div>
  );
}

export function Stepper({ steps, active = 0 }: { steps: string[]; active?: number }) {
  return (
    <div className="mt-4 flex items-center rounded-2xl border border-slate-200 bg-white px-5 py-4">
      {steps.map((label, i) => (
        <div key={label} className={`flex items-center ${i > 0 ? 'flex-1' : ''}`}>
          {i > 0 && <span className="mx-2 h-px flex-1 bg-slate-300 sm:mx-3" />}
          <span className="flex items-center gap-2">
            {i === active ? (
              <span className="h-3 w-3 rounded-full bg-indigo-600" />
            ) : (
              <span className="h-3 w-3 rounded-full border-2 border-slate-300 bg-white" />
            )}
            <span className={`text-sm ${i === active ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Compact submit-one-solution box for a participating crowdsourced host (counted like anyone). */
function HostSubmit({ state, emit }: { state: SessionState; emit: Emit }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);

  const submitted = state.me.submitted || acked;
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // 'closed' can't race here — only the host ends the lobby — but the mapping is shared.
      await submitSolution(emit, text);
      setAcked(true);
    } catch (err) {
      setError(`Something went wrong (${err instanceof Error ? err.message : 'unknown'}). Please try again.`);
    } finally {
      setBusy(false);
    }
  }
  // The live region must outlive the submitted/form swap to announce it.
  return (
    <>
      <LiveStatus message={submitted ? 'Solution submitted.' : null} />
      {submitted ? (
        <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-2 font-medium text-green-800">
            <span aria-hidden>✓</span> Your submission is saved
          </div>
          {(state.me.submissionText ?? text) && <p className="mt-1 text-green-900">{state.me.submissionText ?? text}</p>}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="font-semibold text-slate-900">You are participating — submit one solution</div>
          <div className="relative mt-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, SOLUTION_MAX_LENGTH))}
              placeholder="Describe your best solution..."
              rows={3}
              className="w-full rounded-xl border border-slate-300 bg-white p-3 pb-7 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500"
            />
            <span className="pointer-events-none absolute bottom-3 right-3 text-sm text-slate-400">
              {text.length} / {SOLUTION_MAX_LENGTH}
            </span>
          </div>
          <button
            onClick={() => void submit()}
            disabled={!text.trim() || busy}
            className={`${btnPrimary} mt-2 rounded-lg px-4 py-2`}
          >
            {busy ? 'Submitting…' : 'Submit solution'}
          </button>
          {error && <ErrorText className="mt-2">{error}</ErrorText>}
        </div>
      )}
    </>
  );
}

function CrowdsourcedBody({ state, emit, fail }: { state: SessionState; emit: Emit; fail: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const deck = state.deck ?? [];
  const submissions = state.submissions ?? { submitted: 0, total: 0 };
  const pct = percentComplete(submissions.submitted, submissions.total);
  return (
    <>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Solutions arriving</h2>
          <span className="rounded-full bg-indigo-50 px-3 py-0.5 text-sm font-medium text-indigo-700">
            {submissions.submitted} submitted
          </span>
        </div>
        <ul className="mt-4 space-y-2">
          {deck.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" aria-hidden />
              <span className="min-w-0 break-words text-slate-900">{d.text}</span>
            </li>
          ))}
        </ul>
        {deck.length === 0 && <p className="mt-4 text-sm text-slate-500">Waiting for the first submission…</p>}
      </div>

      {state.hostParticipates && <HostSubmit state={state} emit={emit} />}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-900">
            {submissions.submitted} of {submissions.total} submitted
          </span>
          <span className="text-sm text-slate-500">{pct}%</span>
        </div>
        <ProgressBar pct={pct} />
        <p className="mt-2 text-sm text-slate-500">We&rsquo;ll let you know when everyone has submitted.</p>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex flex-1 items-center gap-2 rounded-xl bg-slate-200/60 px-4 py-3 text-sm text-slate-600">
          <span aria-hidden>ℹ️</span> At least one Solution is required to start the vote.
        </p>
        <button
          onClick={() => {
            setBusy(true);
            beginCuration(emit)
              .catch(fail)
              .finally(() => setBusy(false));
          }}
          disabled={busy}
          className={`${btnPrimary} rounded-lg px-6 py-3`}
        >
          Begin curation
        </button>
      </div>
    </>
  );
}

function PresetBody({ state, emit, fail }: { state: SessionState; emit: Emit; fail: (e: unknown) => void }) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [emptyDeck, setEmptyDeck] = useState(false);
  const deck = state.deck ?? [];
  const { count, cap } = state.participants;
  const pct = percentComplete(count, cap);

  function run(op: Promise<unknown>) {
    setBusy(true);
    op.catch(fail).finally(() => setBusy(false));
  }
  function add() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    // Draft and empty-deck notice clear only on a successful ack — a failed add keeps both.
    addSolution(emit, text)
      .then(() => {
        setDraft('');
        setEmptyDeck(false);
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }
  function saveEdit(id: string) {
    const text = editText.trim();
    setEditingId(null);
    if (text) run(editSolution(emit, id, text));
  }
  async function start() {
    setBusy(true);
    try {
      setEmptyDeck((await startVoting(emit)) === 'empty-deck');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Preset Deck</h2>
          {state.hostParticipates && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
              ✓ You are participating
            </span>
          )}
        </div>
        <ul className="mt-4 space-y-2">
          {deck.map((d) =>
            editingId === d.id ? (
              <li key={d.id} className="flex items-center gap-2 rounded-xl border border-indigo-300 px-3 py-2">
                <input
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(d.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  maxLength={SOLUTION_MAX_LENGTH}
                  autoFocus
                  className="w-full bg-transparent py-1 text-slate-900"
                />
                <button
                  onClick={() => saveEdit(d.id)}
                  className={`${btnLink} shrink-0 text-sm`}
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className={`${btnGhost} shrink-0 text-sm`}
                >
                  Cancel
                </button>
              </li>
            ) : (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <span className="min-w-0 break-words text-slate-900">{d.text}</span>
                <span className="flex shrink-0 gap-1">
                  <button
                    onClick={() => {
                      setEditingId(d.id);
                      setEditText(d.text);
                    }}
                    aria-label={`Edit ${d.text}`}
                    className={`${btnGhost} rounded border border-slate-200 px-2 py-1`}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => run(deleteSolution(emit, d.id))}
                    disabled={busy}
                    aria-label={`Delete ${d.text}`}
                    className={`${btnGhostDanger} rounded border border-slate-200 px-2 py-1`}
                  >
                    🗑️
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
            maxLength={SOLUTION_MAX_LENGTH}
            placeholder="Add a solution"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500"
          />
          <button
            onClick={add}
            disabled={!draft.trim() || busy}
            className={`${btnSecondary} shrink-0 rounded-lg border-indigo-600 px-3 py-2 text-sm`}
          >
            Add solution
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="font-semibold text-slate-900">
          {count} of {cap} participants
        </div>
        <div className="flex items-center justify-between">
          <span className="mt-1 text-sm text-slate-500">Waiting for others to join…</span>
          <span className="text-sm text-slate-500">{pct}%</span>
        </div>
        <ProgressBar pct={pct} />
      </div>

      {emptyDeck && (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span aria-hidden>ℹ️</span> Add at least one Solution to start voting.
        </p>
      )}
      <button
        onClick={() => void start()}
        disabled={busy}
        className={`${btnPrimary} mt-4 w-full rounded-lg px-4 py-3`}
      >
        Start voting
      </button>
    </>
  );
}

/** Mock 06 — the host's lobby, both workflows. Live data arrives via session:state snapshots. */
export function HostLobby({ state, emit }: { state: SessionState; emit: Emit }) {
  const [error, setError] = useState<string | null>(null);
  const fail = (err: unknown) =>
    setError(`Something went wrong (${err instanceof Error ? err.message : 'unknown'}). Please try again.`);
  const workflowLabel = state.workflow === 'preset' ? 'Preset' : 'Crowdsourced';
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
        <span className="rounded-full border border-slate-300 px-3 py-0.5 text-sm text-slate-700">
          👤 {workflowLabel}
        </span>
      </header>
      <main className="mx-auto max-w-2xl p-4 pb-10 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          {state.joinCode && <JoinCode code={state.joinCode} />}
          <div>
            <div className="text-sm text-slate-500">Participants</div>
            <div className="text-2xl font-semibold text-slate-900">
              <span className="text-green-600">{state.participants.count}</span> / {state.participants.cap}
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-500">Workflow</div>
            <span
              className={`mt-1 inline-block rounded-full px-3 py-0.5 text-sm font-medium ${
                state.workflow === 'preset' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-700'
              }`}
            >
              {workflowLabel}
            </span>
          </div>
        </div>

        <Stepper steps={hostSteps(state.workflow)} />

        {state.workflow === 'crowdsourced' ? (
          <CrowdsourcedBody state={state} emit={emit} fail={fail} />
        ) : (
          <PresetBody state={state} emit={emit} fail={fail} />
        )}

        {error && <ErrorText className="mt-4">{error}</ErrorText>}
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500">
          <span aria-hidden>🕐</span> You can leave this page — we&rsquo;ll bring you back here.
        </p>
      </main>
    </div>
  );
}
