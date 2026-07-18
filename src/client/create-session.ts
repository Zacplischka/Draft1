import { CAP_MAX, CAP_MIN, PROBLEM_MAX_LENGTH, type Ack, type Workflow } from '../shared/contract';

export type Details = {
  problem: string;
  workflow: Workflow;
  cap: number;
  hostParticipates: boolean;
};

// Rejoin key (contract: clients store sessionId from the ack; #14/#23 read it back).
export const SESSION_ID_KEY = 'session-id';

/** Inline-error copy per mock 03's validation state; empty result = Create enabled. */
export function validateDetails(problem: string, cap: number): { problem?: string; cap?: string } {
  const errors: { problem?: string; cap?: string } = {};
  if (!problem.trim()) errors.problem = 'Enter a problem statement.';
  else if (problem.length > PROBLEM_MAX_LENGTH) errors.problem = 'Problem statement is too long.';
  if (!Number.isInteger(cap) || cap < CAP_MIN || cap > CAP_MAX)
    errors.cap = `Enter a number from ${CAP_MIN} to ${CAP_MAX}.`;
  return errors;
}

export type Emit = (event: string, payload: unknown) => Promise<Ack<any>>;

/** The contract orchestration: session:create, then one solution:add per preset row. */
export async function createSession(
  emit: Emit,
  details: Details,
  solutions: string[],
): Promise<{ sessionId: string; joinCode: string }> {
  const ack = (await emit('session:create', details)) as Ack<{ sessionId: string; joinCode: string }>;
  if (!('ok' in ack)) throw new Error(ack.error);
  for (const text of solutions) {
    const added = await emit('solution:add', { text });
    if (!('ok' in added)) throw new Error(added.error);
  }
  return { sessionId: ack.sessionId, joinCode: ack.joinCode };
}
