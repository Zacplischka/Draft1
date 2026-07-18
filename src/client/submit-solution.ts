import type { Ack, SessionState } from '../shared/contract';
import type { Emit } from './create-session';

/** Which mock-05 participant screen a snapshot lands on. Submissions are open only in a
 *  crowdsourced lobby for someone who hasn't submitted — everything after that waits. */
export function participantView(s: SessionState): 'submit' | 'waiting' {
  return s.phase === 'lobby' && !s.me.submitted ? 'submit' : 'waiting';
}

/** Mock 05's "62% complete" for 5/8 — floored, never NaN. */
export function percentComplete(submitted: number, total: number): number {
  return total > 0 ? Math.floor((submitted / total) * 100) : 0;
}

/** ok → 'submitted'. already-submitted / bad-phase (raced curation:start) → 'closed' —
 *  both route to the waiting state, never an error (contract). Other codes throw. */
export async function submitSolution(emit: Emit, text: string): Promise<'submitted' | 'closed'> {
  const ack = (await emit('solution:submit', { text })) as Ack;
  if ('ok' in ack) return 'submitted';
  if (ack.error === 'already-submitted' || ack.error === 'bad-phase') return 'closed';
  throw new Error(ack.error);
}
