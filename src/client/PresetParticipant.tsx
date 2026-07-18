import type { SessionState } from '../shared/contract';

/** Mock 06's preset-participant waiting screen — nothing to do until the host starts voting. */
export function PresetParticipant({ state }: { state: SessionState }) {
  return (
    <div className="flex min-h-screen justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm text-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
          👤 Preset
        </span>
        <div className="mt-3 font-semibold text-slate-900">🗳️ Group Decision</div>
        <div className="mt-4 text-sm text-slate-500">Join code</div>
        <div className="text-2xl font-semibold tracking-widest text-slate-900">
          {state.joinCode && `${state.joinCode.slice(0, 3)} ${state.joinCode.slice(3)}`}
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 text-lg font-medium text-slate-900">
          {state.problem}
        </div>
        <span className="mx-auto mt-8 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 text-3xl">
          ⏳
        </span>
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Waiting for the Host</h1>
        <p className="mt-2 text-slate-500">You&rsquo;ll go straight to voting when the Deck is ready.</p>
        <div className="mt-6 text-sm text-slate-500">Participants</div>
        <div className="text-2xl font-semibold text-slate-900">
          <span className="text-green-600">{state.participants.count}</span> / {state.participants.cap}
        </div>
        <p className="mt-8 flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          <span aria-hidden>🕐</span> You can leave this page — we&rsquo;ll bring you back here.
        </p>
      </div>
    </div>
  );
}
