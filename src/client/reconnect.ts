import type { Ack, Phase } from '../shared/contract';
import type { Emit } from './create-session';

export type RejoinKind = 'cold' | 'reconnect';

/** sessionId rejoin — legal in ANY phase for a member (contract). not-found means the
 *  stored id is dead (or we were never a member): clear storage and go home. */
export async function rejoinSession(emit: Emit, sessionId: string): Promise<'rejoined' | 'stale'> {
  const ack = (await emit('session:join', { sessionId })) as Ack;
  if ('ok' in ack) return 'rejoined';
  if (ack.error === 'not-found') return 'stale';
  throw new Error(ack.error);
}

/** Where the rejoin snapshot lands. A COLD-load auto-rejoin that finds the session already
 *  at results reopens a finished session the user never asked for — home instead (#23);
 *  a live reconnect at results is the voting-ended flow and stays on the ranked list. */
export function landedRoute(kind: RejoinKind, phase: Phase): 'session' | 'home' {
  return kind === 'cold' && phase === 'results' ? 'home' : 'session';
}
