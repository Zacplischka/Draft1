import type { SessionState } from '../shared/contract';
import { btnLink } from './button';

// ponytail: placeholder host lobby — #16 builds the real crowdsourced/preset lobbies.
export function Lobby({ state, onBack }: { state: SessionState | null; onBack: () => void }) {
  if (!state) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
      </header>
      <main className="mx-auto max-w-lg p-6">
        <button onClick={onBack} className={`${btnLink} text-sm`}>
          &lsaquo; Sessions
        </button>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {state.workflow === 'preset' ? 'Preset' : 'Crowdsourced'} lobby
        </h1>
        <p className="mt-2 text-slate-700">{state.problem}</p>
        {state.joinCode && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-center">
            <div className="text-sm text-slate-500">Join code</div>
            <div className="text-3xl font-semibold tracking-widest text-slate-900">{state.joinCode}</div>
          </div>
        )}
        <p className="mt-4 text-sm text-slate-500">
          {state.participants.count} of {state.participants.cap} participants
        </p>
      </main>
    </div>
  );
}
