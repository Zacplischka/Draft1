import { useEffect, useRef, useState } from 'react';
import { SCORE_MAX, SCORE_MIN, type SessionState } from '../shared/contract';
import type { Emit } from './create-session';
import { percentComplete } from './submit-solution';
import { ProgressBar } from './HostLobby';
import {
  angleToScore,
  clearScores,
  loadScores,
  nextUnscored,
  pruneScores,
  saveScores,
  scoreColor,
  submitBallot,
  type Scores,
} from './vote';

const clamp = (n: number) => Math.min(SCORE_MAX, Math.max(SCORE_MIN, n));

/** Inverse of vote.ts's angleToScore: ring angle for a score (π at 0-anchor, 0 at 100). */
const thetaOf = (score: number) => Math.PI * (1 - score / SCORE_MAX);

/** SVG arc along the ring from the 0-anchor (left) to the current score's angle. */
function arcPath(score: number, c: number, r: number): string {
  const theta = thetaOf(score);
  const x = c + r * Math.cos(theta);
  const y = c - r * Math.sin(theta);
  return `M ${c - r} ${c} A ${r} ${r} 0 0 1 ${x} ${y}`;
}

function SolutionTile({ text, dimmed }: { text: string; dimmed?: boolean }) {
  return (
    <div
      className={`w-44 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-md ${dimmed ? 'opacity-50' : ''}`}
    >
      <span aria-hidden className="text-2xl">
        📄
      </span>
      <p className="mt-2 text-sm font-medium text-slate-900">{text}</p>
    </div>
  );
}

/** The swipe ring — drag maps angle to score, release past the ring casts (mock 08). */
function SwipeRing({ text, onCast }: { text: string; onCast: (score: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ score: number; past: boolean } | null>(null);

  function trackPointer(e: React.PointerEvent) {
    const r = box.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    setDrag({ score: angleToScore(dx, dy), past: Math.hypot(dx, dy) > r.width * 0.45 });
  }

  const theta = drag ? thetaOf(drag.score) : 0;
  const color = drag ? scoreColor(drag.score) : '';
  return (
    <>
      <div className="relative mx-auto mt-10 w-72 max-w-full">
        {/* Anchor labels */}
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-center text-sm">
          <div className="font-semibold text-amber-600">50</div>
          <div className="text-amber-600">Unsure</div>
        </div>
        <div className="absolute -left-9 top-1/2 -translate-y-1/2 text-center text-sm">
          <div className="font-semibold text-red-600">0</div>
          <div className="text-red-600">Reject</div>
        </div>
        <div className="absolute -right-12 top-1/2 -translate-y-1/2 w-20 text-center text-sm">
          <div className="font-semibold text-green-600">100</div>
          <div className="text-green-600">Strong confidence</div>
        </div>

        <div
          ref={box}
          className="relative aspect-square w-full touch-none select-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            trackPointer(e);
          }}
          onPointerMove={(e) => drag && trackPointer(e)}
          onPointerUp={() => {
            if (drag?.past) onCast(drag.score);
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
        >
          <svg viewBox="0 0 300 300" className="absolute inset-0 h-full w-full">
            <circle cx="150" cy="150" r="135" fill="none" stroke="#e2e8f0" strokeWidth="5" />
            {drag && (
              <>
                <path d={arcPath(drag.score, 150, 135)} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
                <circle cx={150 + 135 * Math.cos(theta)} cy={150 - 135 * Math.sin(theta)} r="8" fill={color} />
              </>
            )}
          </svg>
          {/* Live score bubble just outside the ring at the current angle */}
          {drag && (
            <div
              className="absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-2xl font-semibold shadow-lg"
              style={{
                left: `${50 + 53 * Math.cos(theta)}%`,
                top: `${50 - 53 * Math.sin(theta)}%`,
                color: color,
              }}
            >
              {drag.score}
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <SolutionTile text={text} dimmed={!!drag} />
          </div>
        </div>
      </div>

      <div className="mt-8 text-center">
        {drag && (
          <span
            className="inline-block rounded-full px-3 py-1 text-sm font-medium text-white"
            style={{ backgroundColor: color }}
          >
            Confidence {drag.score}
          </span>
        )}
        <p className="mt-2 flex items-center justify-center gap-2 text-slate-500">
          <span aria-hidden>🖐️</span> {drag ? (drag.past ? 'Release to score' : 'Swipe past the ring to score') : 'Swipe past the ring to score'}
        </p>
      </div>
    </>
  );
}

/** Manual fallback: −/+ stepper + slider + Set score (mock 08 third panel). */
function ManualScore({ text, onCast, onBack }: { text: string; onCast: (score: number) => void; onBack: () => void }) {
  const [score, setScore] = useState(50);
  return (
    <div className="mx-auto mt-10 max-w-xs text-center">
      <div className="flex justify-center">
        <SolutionTile text={text} />
      </div>
      <div className="mt-8 font-medium text-slate-900">Set your Confidence score</div>
      <div className="mt-3 flex items-center justify-center gap-6">
        <button
          onClick={() => setScore((s) => clamp(s - 1))}
          aria-label="Decrease score"
          className="h-11 w-11 rounded-xl border border-slate-300 bg-white text-xl text-slate-700 hover:bg-slate-50"
        >
          −
        </button>
        <span className="w-16 text-4xl font-semibold" style={{ color: scoreColor(score) }}>
          {score}
        </span>
        <button
          onClick={() => setScore((s) => clamp(s + 1))}
          aria-label="Increase score"
          className="h-11 w-11 rounded-xl border border-slate-300 bg-white text-xl text-slate-700 hover:bg-slate-50"
        >
          +
        </button>
      </div>
      <div className="mt-4 flex items-center gap-3 text-sm text-slate-500">
        <span>0</span>
        <input
          type="range"
          min={SCORE_MIN}
          max={SCORE_MAX}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          aria-label="Confidence score"
          className="w-full accent-indigo-600"
        />
        <span>100</span>
      </div>
      <button
        onClick={() => onCast(score)}
        className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700"
      >
        Set score
      </button>
      <button onClick={onBack} className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-700">
        Back to swipe
      </button>
    </div>
  );
}

/** ±1 adjuster sheet shown when Edit before submit intercepts a release (mock 08 fourth panel). */
function AdjustSheet({
  score,
  onChange,
  onSubmit,
  onReswipe,
}: {
  score: number;
  onChange: (score: number) => void;
  onSubmit: () => void;
  onReswipe: () => void;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-6 text-center shadow-xl sm:rounded-3xl">
        <h2 className="text-lg font-semibold text-slate-900">Adjust your Confidence score</h2>
        <div className="mt-2 text-6xl font-semibold" style={{ color: scoreColor(score) }}>
          {score}
        </div>
        <div className="mt-4 flex justify-center gap-24">
          <button
            onClick={() => onChange(clamp(score - 1))}
            className="h-11 w-14 rounded-xl border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50"
          >
            −1
          </button>
          <button
            onClick={() => onChange(clamp(score + 1))}
            className="h-11 w-14 rounded-xl border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50"
          >
            +1
          </button>
        </div>
        <button
          onClick={onSubmit}
          className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700"
        >
          Submit score
        </button>
        <button
          onClick={onReswipe}
          className="mt-3 w-full rounded-lg border border-indigo-200 px-4 py-2.5 font-medium text-indigo-600 hover:bg-indigo-50"
        >
          Re-swipe
        </button>
      </div>
    </div>
  );
}

export function Voting({ state, emit }: { state: SessionState; emit: Emit }) {
  const deck = state.deck ?? [];
  // One read of the device-local scores seeds both the score map and the resumed banner.
  const [initial] = useState(() => {
    const saved = pruneScores(deck, loadScores(state.sessionId));
    const i = nextUnscored(deck, saved);
    return { saved, resumed: i > 0 && i < deck.length };
  });
  const [scores, setScores] = useState<Scores>(initial.saved);
  const resumed = initial.resumed;
  const [mode, setMode] = useState<'swipe' | 'manual'>('swipe');
  const [editBeforeSubmit, setEditBeforeSubmit] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [ballot, setBallot] = useState<'idle' | 'busy' | 'submitted' | 'ended' | 'error'>('idle');
  const inFlight = useRef(false);

  const index = nextUnscored(deck, scores);
  const done = deck.length > 0 && index === deck.length;
  const voted = state.me.voted || ballot === 'submitted';

  async function finish(all: Scores) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBallot('busy');
    try {
      const r = await submitBallot(emit, all);
      if (r === 'incomplete') {
        // Stale device scores didn't cover the deck — resume at the missing Solution.
        const pruned = pruneScores(deck, all);
        saveScores(state.sessionId, pruned);
        setScores(pruned);
        setBallot('idle');
      } else {
        // 'ended' = raced voting:close — voting is over, the results snapshot routes away.
        clearScores(state.sessionId);
        setBallot(r);
      }
    } catch {
      setBallot('error');
    } finally {
      inFlight.current = false;
    }
  }

  // A refresh after the last Solution but before the ack still submits (device-local resume).
  useEffect(() => {
    if (done && !voted && ballot === 'idle') void finish(scores);
  }, [done]);

  function cast(score: number) {
    if (editBeforeSubmit) setPending(score);
    else commit(score);
  }

  function commit(score: number) {
    const next = { ...scores, [deck[index]!.id]: score };
    saveScores(state.sessionId, next);
    setScores(next);
    setPending(null);
    if (nextUnscored(deck, next) === deck.length) void finish(next);
  }

  const solution = deck[index];
  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 p-6 pb-24">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700">Voting</span>
          <span className="text-slate-700">
            Solution {Math.min(index + 1, deck.length)} of {deck.length}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-indigo-600 transition-all"
            style={{ width: `${deck.length ? (index / deck.length) * 100 : 0}%` }}
          />
        </div>

        {/* Collapsed = one truncated line; open = full problem statement. */}
        <details className="group mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-slate-700">
            <span aria-hidden>❓</span>
            <span className="min-w-0 flex-1 truncate group-open:whitespace-normal">{state.problem}</span>
            <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
        </details>

        {resumed && !voted && (
          <p className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
            ✓ Voting resumed — picking up where you left off.
          </p>
        )}

        {ballot === 'ended' ? (
          // Raced voting:close — no ballot was counted; the results snapshot routes away.
          <div className="mt-16 text-center">
            <h1 className="text-2xl font-semibold text-slate-900">Voting has ended</h1>
            <p className="mt-2 text-slate-500">Taking you to the results…</p>
          </div>
        ) : voted || ballot === 'busy' ? (
          <div className="mt-16 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600">
              ✓
            </span>
            <h1 className="mt-4 text-2xl font-semibold text-slate-900">
              {ballot === 'busy' ? 'Submitting your ballot…' : 'Your ballot is submitted'}
            </h1>
            <p className="mt-2 text-slate-500">Waiting for others to finish.</p>
            {state.votingProgress && (
              <div className="mt-8 text-left">
                <div className="font-medium text-slate-900">
                  {state.votingProgress.voted} of {state.votingProgress.total} Participants voted
                </div>
                <ProgressBar pct={percentComplete(state.votingProgress.voted, state.votingProgress.total)} />
              </div>
            )}
            <p className="mt-6 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-left text-sm text-green-800">
              <span aria-hidden>👥</span> Your full ballot was submitted together.
            </p>
            <p className="mt-8 text-sm text-slate-500">
              This Session will complete automatically when everyone has voted.
            </p>
          </div>
        ) : ballot === 'error' ? (
          <div className="mt-16 text-center">
            <p className="text-red-600">Something went wrong submitting your ballot.</p>
            <button
              onClick={() => void finish(scores)}
              className="mt-4 rounded-lg bg-indigo-600 px-6 py-2.5 font-medium text-white hover:bg-indigo-700"
            >
              Try again
            </button>
          </div>
        ) : solution ? (
          <>
            {mode === 'swipe' ? (
              <>
                <SwipeRing key={solution.id} text={solution.text} onCast={cast} />
                <div className="mt-8 text-center">
                  <button
                    onClick={() => setMode('manual')}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    Use manual buttons
                  </button>
                </div>
              </>
            ) : (
              <ManualScore key={solution.id} text={solution.text} onCast={cast} onBack={() => setMode('swipe')} />
            )}
            {pending !== null && (
              <AdjustSheet
                score={pending}
                onChange={setPending}
                onSubmit={() => commit(pending)}
                onReswipe={() => {
                  setPending(null);
                  setMode('swipe'); // the button says Re-swipe — leave manual mode too
                }}
              />
            )}
          </>
        ) : null}
      </main>
      {!voted && ballot !== 'busy' && ballot !== 'ended' && (
        <footer className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-md items-center justify-between px-6 py-4">
            <span className="text-slate-700">Edit before submit</span>
            <button
              role="switch"
              aria-checked={editBeforeSubmit}
              aria-label="Edit before submit"
              onClick={() => setEditBeforeSubmit((v) => !v)}
              className={`h-7 w-12 rounded-full p-1 transition-colors ${editBeforeSubmit ? 'bg-indigo-600' : 'bg-slate-300'}`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${editBeforeSubmit ? 'translate-x-5' : ''}`}
              />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
