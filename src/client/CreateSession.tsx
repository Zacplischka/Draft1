import { useState } from 'react';
import type { Socket } from 'socket.io-client';
import { CAP_DEFAULT, CAP_MAX, CAP_MIN, PROBLEM_MAX_LENGTH, SOLUTION_MAX_LENGTH, type Workflow } from '../shared/contract';
import { createSession, SESSION_ID_KEY, validateDetails } from './create-session';

const WORKFLOWS: { value: Workflow; label: string; blurb: string }[] = [
  {
    value: 'crowdsourced',
    label: 'Crowdsourced',
    blurb: 'Participants submit one anonymous solution, then you curate the Deck',
  },
  { value: 'preset', label: 'Preset', blurb: 'You prepare the Deck before voting' },
];

/** Mock 03: two-step create form (Solutions step only for Preset) + live Session preview. */
export function CreateSession({
  socket,
  onBack,
  onCreated,
  onProfileRequired,
}: {
  socket: Socket;
  onBack: () => void;
  onCreated: (sessionId: string) => void;
  onProfileRequired: () => void;
}) {
  const [problem, setProblem] = useState('');
  const [problemTouched, setProblemTouched] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow>('crowdsourced');
  const [capText, setCapText] = useState(String(CAP_DEFAULT));
  const [hostParticipates, setHostParticipates] = useState(true);
  const [solutions, setSolutions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cap = capText === '' ? NaN : Number(capText);
  const errors = validateDetails(problem, cap);
  const invalid = Boolean(errors.problem || errors.cap);

  function addSolution() {
    const text = draft.trim();
    if (!text) return;
    setSolutions([...solutions, text]);
    setDraft('');
  }

  async function create() {
    setSubmitting(true);
    setError(null);
    try {
      const { sessionId } = await createSession(
        (event, payload) => socket.emitWithAck(event, payload),
        { problem, workflow, cap, hostParticipates },
        workflow === 'preset' ? solutions : [],
      );
      localStorage.setItem(SESSION_ID_KEY, sessionId);
      onCreated(sessionId);
    } catch (err) {
      if (err instanceof Error && err.message === 'profile-required') {
        onProfileRequired();
        return;
      }
      setError(`Could not create session (${err instanceof Error ? err.message : 'unknown'}). Please try again.`);
      setSubmitting(false);
    }
  }

  const fieldClass = (bad: boolean) =>
    `w-full rounded-lg border bg-white px-3 py-2.5 text-slate-900 focus:outline-none ${
      bad ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-indigo-500'
    }`;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
      </header>
      <main className="mx-auto max-w-4xl p-6">
        <button onClick={onBack} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          &lsaquo; Sessions
        </button>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Create session</h1>

        <div className="mt-4 flex items-center gap-3 text-sm">
          <span className="flex items-center gap-2 font-medium text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">
              1
            </span>
            Details
          </span>
          <span className="h-px w-10 bg-slate-300" />
          {/* Step 2 stays outlined even when its section shows — matches the mock's preset panel. */}
          <span className="flex items-center gap-2 text-slate-400">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-xs text-slate-400">
              2
            </span>
            Solutions
          </span>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_18rem]">
          <div className="space-y-6">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Problem statement</span>
              <textarea
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                onBlur={() => setProblemTouched(true)}
                maxLength={PROBLEM_MAX_LENGTH}
                rows={3}
                placeholder="Enter a problem statement."
                className={fieldClass(problemTouched && Boolean(errors.problem))}
              />
              {problemTouched && errors.problem && <span className="mt-1 block text-sm text-red-600">{errors.problem}</span>}
            </label>

            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-700">Workflow</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {WORKFLOWS.map((w) => (
                  <label
                    key={w.value}
                    className={`cursor-pointer rounded-xl border p-4 ${
                      workflow === w.value ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                      <input
                        type="radio"
                        name="workflow"
                        checked={workflow === w.value}
                        onChange={() => setWorkflow(w.value)}
                        className="accent-amber-500"
                      />
                      {w.label}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500">{w.blurb}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {workflow === 'preset' && (
              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Preset solutions</span>
                <ul className="space-y-2">
                  {solutions.map((text, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900"
                    >
                      <span className="min-w-0 break-words">{text}</span>
                      <button
                        onClick={() => setSolutions(solutions.filter((_, j) => j !== i))}
                        aria-label={`Remove ${text}`}
                        className="rounded border border-slate-200 px-2 text-slate-400 hover:text-slate-600"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addSolution();
                    }}
                    maxLength={SOLUTION_MAX_LENGTH}
                    placeholder="Add a solution"
                    className={fieldClass(false)}
                  />
                  <button
                    onClick={addSolution}
                    disabled={!draft.trim()}
                    className="shrink-0 rounded-lg border border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:border-slate-300 disabled:text-slate-400"
                  >
                    Add solution
                  </button>
                </div>
              </div>
            )}

            <label className="block max-w-40">
              <span className="mb-1 block text-sm font-medium text-slate-700">Participant cap</span>
              <input
                type="number"
                min={CAP_MIN}
                max={CAP_MAX}
                value={capText}
                onChange={(e) => setCapText(e.target.value)}
                className={fieldClass(Boolean(errors.cap))}
              />
              <span className={`mt-1 block text-sm ${errors.cap ? 'text-red-600' : 'text-slate-500'}`}>
                {errors.cap ?? `Maximum ${CAP_MAX}`}
              </span>
            </label>

            <label className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-700">I&rsquo;ll participate</span>
              <input
                type="checkbox"
                role="switch"
                checked={hostParticipates}
                onChange={(e) => setHostParticipates(e.target.checked)}
                className="h-5 w-9 accent-indigo-600"
              />
            </label>
          </div>

          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">🗳️ Session preview</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Workflow</dt>
                <dd className="text-slate-900">{workflow === 'preset' ? 'Preset' : 'Crowdsourced'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Participant cap</dt>
                <dd className={errors.cap ? 'text-red-600' : 'text-slate-900'}>
                  {capText || '—'} participants
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Host participation</dt>
                <dd className="text-slate-900">
                  {hostParticipates ? 'Yes, I’ll participate' : 'No, I’ll observe'}
                </dd>
              </div>
            </dl>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              onClick={() => void create()}
              disabled={invalid || submitting}
              className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:bg-slate-300"
            >
              {submitting ? 'Creating…' : 'Create session'}
            </button>
          </aside>
        </div>
      </main>
    </div>
  );
}
