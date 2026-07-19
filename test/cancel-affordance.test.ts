import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SessionState } from '../src/shared/contract';
import { Voting } from '../src/client/Voting';

const state = (isHost: boolean): SessionState => ({
  sessionId: 'session-1',
  joinCode: '482731',
  problem: 'Which customer problem should we solve next?',
  workflow: 'preset',
  phase: 'voting',
  participants: { count: 2, cap: 8 },
  isHost,
  hostParticipates: true,
  me: { submitted: false, voted: false },
  deck: [{ id: 'solution-1', text: 'Improve onboarding', combined: false }],
  votingProgress: { voted: 0, total: 2 },
});

describe('Cancel session affordance', () => {
  it('is visible mid-ballot to a participating host, never an ordinary participant', () => {
    const render = (isHost: boolean) =>
      renderToStaticMarkup(
        createElement(Voting, {
          state: state(isHost),
          emit: async () => ({ ok: true as const }),
        }),
      );

    expect(render(true)).toContain('Cancel session');
    expect(render(false)).not.toContain('Cancel session');
  });
});
