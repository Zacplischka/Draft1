import type { Ack, Phase, Workflow } from '../shared/contract';
import type { Emit } from './create-session';

export type Preview = {
  problem: string;
  workflow: Workflow;
  phase: Phase;
  participants: { count: number; cap: number };
  isMember: boolean;
};

export type Screen = 'found' | 'rejoin' | 'full' | 'voting-started';

/** Which mock-04 screen a successful preview lands on.
 *  Full/voting-started blocks apply to NEW joiners only — a member always gets Rejoin. */
export function screenFor(p: Preview): Screen {
  if (p.isMember) return 'rejoin';
  if (p.phase === 'voting') return 'voting-started';
  if (p.participants.count >= p.participants.cap) return 'full';
  return 'found';
}

/** Read-only lookup before joining; throws the ack ErrorCode ('not-found' = wrong code). */
export async function previewSession(emit: Emit, joinCode: string): Promise<Preview> {
  const ack = (await emit('session:preview', { joinCode })) as Ack<Preview>;
  if (!('ok' in ack)) throw new Error(ack.error);
  const { problem, workflow, phase, participants, isMember } = ack;
  return { problem, workflow, phase, participants, isMember };
}

/** Join (or idempotently rejoin) by code; resolves the sessionId — the rejoin key to persist. */
export async function joinSession(emit: Emit, joinCode: string): Promise<string> {
  const ack = (await emit('session:join', { joinCode })) as Ack<{ sessionId: string }>;
  if (!('ok' in ack)) throw new Error(ack.error);
  return ack.sessionId;
}
