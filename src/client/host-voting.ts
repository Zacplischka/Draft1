import type { Ack, SessionState } from '../shared/contract';
import type { Emit } from './create-session';

/** Host's escape hatch (mock 09 confirm dialog). ok → closed; bad-phase → closed too —
 *  the last ballot landed while the dialog was open, voting is over either way and the
 *  results snapshot routes everyone away. Others throw. */
export async function closeVoting(emit: Emit): Promise<'closed'> {
  const ack = (await emit('voting:close', {})) as Ack;
  if ('ok' in ack || ack.error === 'bad-phase') return 'closed';
  throw new Error(ack.error);
}

/** Roster avatar chip — first letters of the first two words. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Did this snapshot transition auto-complete the vote? Drives the "Everyone has voted —
 *  opening the Ranked list…" toast. The results snapshot carries no votingProgress, so we
 *  infer from the last voting snapshot: exactly one ballot was outstanding.
 *  ponytail: a host close at exactly total−1 ballots is indistinguishable and also toasts —
 *  harmless copy in a rare race, not worth a server flag. */
export function everyoneVotedAdvance(prev: SessionState | null, next: SessionState): boolean {
  return (
    prev?.phase === 'voting' &&
    next.phase === 'results' &&
    prev.sessionId === next.sessionId &&
    prev.votingProgress != null &&
    prev.votingProgress.total > 0 &&
    prev.votingProgress.voted >= prev.votingProgress.total - 1
  );
}
