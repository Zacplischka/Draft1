import { useState } from 'react';
import { Check } from 'lucide-react';
import { SOLUTION_MAX_LENGTH, type SessionState } from '../shared/contract';
import type { Emit } from './create-session';
import { participantView, percentComplete, submitSolution } from './submit-solution';
import { btnPrimary, BusyButton } from './button';
import { ErrorText, LiveStatus } from './Announce';
import { ProgressBar } from './ProgressBar';

const STEPS = [
  { label: 'Join', sub: 'You joined the session' },
  { label: 'Submit', sub: 'Submit one solution' },
  { label: 'Vote', sub: 'Vote on the curated Deck' },
] as const;

/** Join → Submit → Vote rail; step 1 (Submit) is always the live one on this screen. */
function StepDot({ i }: { i: number }) {
  if (i === 0)
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white">
        <Check className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  if (i === 1) return <span className="h-6 w-6 rounded-full border-4 border-indigo-600 bg-indigo-600" />;
  return <span className="h-6 w-6 rounded-full border-2 border-slate-300 bg-white" />;
}

function ProgressRail() {
  // Mobile only — desktop shows the rail in the Session-progress sidebar (mock 05).
  return (
    <div className="mt-6 flex items-start lg:hidden">
      {STEPS.map((step, i) => (
        <div key={step.label} className="flex flex-1 flex-col items-center">
          <div className="flex w-full items-center">
            <span className={`h-px flex-1 ${i === 0 ? 'bg-transparent' : 'bg-slate-300'}`} />
            <StepDot i={i} />
            <span className={`h-px flex-1 ${i === STEPS.length - 1 ? 'bg-transparent' : 'bg-slate-300'}`} />
          </div>
          <span className={`mt-2 text-sm ${i === 1 ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function SubmissionsBar({ submissions }: { submissions: { submitted: number; total: number } }) {
  const pct = percentComplete(submissions.submitted, submissions.total);
  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="font-semibold text-slate-900">
        {submissions.submitted} of {submissions.total} Participants submitted
      </div>
      <ProgressBar pct={pct} />
      <div className="mt-2 text-sm text-slate-500">{pct}% complete</div>
    </div>
  );
}

function LeaveNote() {
  return (
    <p className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500">
      <span aria-hidden>🕐</span> You can leave this page — we&rsquo;ll bring you back here.
    </p>
  );
}

export function CrowdsourcedParticipant({ state, emit }: { state: SessionState; emit: Emit }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bridges the gap between the ack and the snapshot that reflects it (contract: the ack
  // itself transitions to waiting — 'closed' races included, even if the snapshot is missed).
  const [acked, setAcked] = useState<'submitted' | 'closed' | null>(null);

  const submitted = state.me.submitted || acked === 'submitted';
  const view = submitted || acked === 'closed' ? 'waiting' : participantView(state);
  const ownText = state.me.submissionText ?? (acked === 'submitted' ? text : undefined);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // 'closed': already-submitted / raced curation — route to waiting, never an error.
      setAcked(await submitSolution(emit, text));
    } catch (err) {
      setError(`Something went wrong (${err instanceof Error ? err.message : 'unknown'}). Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
      </header>
      <main className="mx-auto max-w-md p-6 lg:max-w-4xl lg:grid lg:grid-cols-[1fr_18rem] lg:gap-10">
        <div>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700">
            👤 Crowdsourced
          </span>
          <div className="mt-4 flex justify-between">
            <div>
              <div className="text-sm text-slate-500">Join code</div>
              <div className="text-xl font-semibold tracking-wider text-slate-900">
                {state.joinCode && `${state.joinCode.slice(0, 3)} ${state.joinCode.slice(3)}`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-500">Participants</div>
              <div className="text-xl font-semibold text-slate-900">
                <span className="text-green-600">{state.participants.count}</span> / {state.participants.cap}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-sm font-medium text-slate-500">Problem statement</div>
            <div className="mt-1 text-lg font-medium text-slate-900">{state.problem}</div>
          </div>

          <LiveStatus message={submitted ? 'Solution submitted.' : null} />

          {view === 'submit' && (
            <>
              <ProgressRail />
              <h1 className="mt-6 text-2xl font-semibold text-slate-900">Submit one solution</h1>
              <p className="mt-1 text-slate-500">Your Solution is anonymous to everyone, including the Host.</p>
              <div className="relative mt-4">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, SOLUTION_MAX_LENGTH))}
                  placeholder="Describe your best solution..."
                  rows={4}
                  className="w-full rounded-2xl border border-slate-300 bg-white p-4 pb-8 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500"
                />
                <span className="pointer-events-none absolute bottom-3 right-4 text-sm text-slate-400">
                  {text.length} / {SOLUTION_MAX_LENGTH}
                </span>
              </div>
              <BusyButton
                onClick={() => void submit()}
                busy={busy}
                busyLabel="Submitting…"
                disabled={!text.trim()}
                className={`${btnPrimary} mt-4 w-full rounded-lg px-4 py-2.5`}
              >
                Submit solution
              </BusyButton>
              {error && <ErrorText className="mt-3">{error}</ErrorText>}
              <p className="mt-4 text-center text-sm text-slate-500">🔒 You can submit once.</p>
            </>
          )}

          {view === 'waiting' && (
            <>
              <div className="mt-8 text-center">
                <span
                  className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl ${
                    submitted ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {submitted ? <Check className="h-8 w-8" aria-hidden /> : '🕐'}
                </span>
                <h1 className="mt-4 text-2xl font-semibold text-slate-900">
                  {submitted ? 'Solution submitted' : 'Submissions are closed'}
                </h1>
                <p className="mt-2 text-slate-500">Waiting for the Host to curate the Deck.</p>
              </div>
              {state.submissions && <SubmissionsBar submissions={state.submissions} />}
              {submitted && ownText && (
                <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-5">
                  <div className="flex items-center gap-2 font-medium text-green-800">
                    <Check className="h-4 w-4 shrink-0" aria-hidden /> Your submission is saved
                  </div>
                  <p className="mt-1 text-green-900">{ownText}</p>
                </div>
              )}
              <LeaveNote />
            </>
          )}
        </div>

        {/* Desktop side panel — session progress rail + About this session (mock 05 desktop). */}
        <aside className="hidden lg:block">
          <div className="text-sm font-medium text-slate-500">Session progress</div>
          <ol className="mt-4 space-y-5">
            {STEPS.map((step, i) => (
              <li key={step.label} className="flex gap-3">
                <StepDot i={i} />
                <div>
                  <div className="text-sm font-medium text-slate-900">{step.label}</div>
                  <div className="text-sm text-slate-500">{step.sub}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
            <div className="flex items-center gap-2 font-medium text-slate-900">
              <span aria-hidden>ℹ️</span> About this session
            </div>
            <p className="mt-2 text-slate-500">
              The Host will review all submissions and build a Deck for everyone to vote on.
            </p>
            <p className="mt-3 flex gap-2 text-slate-500">
              <span aria-hidden>🔒</span> Your Solution is anonymous to everyone, including the Host.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
