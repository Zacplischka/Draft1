import type { Ack, Workflow } from '../shared/contract';
import type { Emit } from './create-session';

/** Mock 06's phase stepper — curation exists only in the crowdsourced workflow. */
export function hostSteps(workflow: Workflow): string[] {
  return workflow === 'crowdsourced'
    ? ['Lobby', 'Curation', 'Voting', 'Ranked list']
    : ['Lobby', 'Voting', 'Ranked list'];
}

/** Ack or throw — deck edits and curation:start have no expected failure to special-case. */
async function mustAck(emit: Emit, event: string, payload: unknown): Promise<void> {
  const ack = (await emit(event, payload)) as Ack;
  if (!('ok' in ack)) throw new Error(ack.error);
}

export const addSolution = (emit: Emit, text: string) => mustAck(emit, 'solution:add', { text });
export const editSolution = (emit: Emit, solutionId: string, text: string) =>
  mustAck(emit, 'solution:edit', { solutionId, text });
export const deleteSolution = (emit: Emit, solutionId: string) =>
  mustAck(emit, 'solution:delete', { solutionId });
export const combineSolutions = (emit: Emit, solutionIds: string[], text: string) =>
  mustAck(emit, 'solution:combine', { solutionIds, text });

/** The combine modal's prefill — the server's default join, editable before confirming. */
export const defaultCombinedText = (texts: string[]) => texts.join(' / ');

/** Always legal, even with zero submissions — empty-deck gates only voting:start (contract). */
export const beginCuration = (emit: Emit) => mustAck(emit, 'curation:start', {});

export const cancelSession = (emit: Emit) => mustAck(emit, 'session:cancel', {});

/** empty-deck is an expected inline state (mock 06's "at least one Solution"), not a crash. */
export async function startVoting(emit: Emit): Promise<'started' | 'empty-deck'> {
  const ack = (await emit('voting:start', {})) as Ack;
  if ('ok' in ack) return 'started';
  if (ack.error === 'empty-deck') return 'empty-deck';
  throw new Error(ack.error);
}
