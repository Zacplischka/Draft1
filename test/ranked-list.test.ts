import { describe, expect, it } from 'vitest';
import { rankedListText } from '../src/client/ranked-list';

describe('rankedListText: the Copy Ranked list clipboard payload', () => {
  it('problem statement first, then ranks numbered from 1 with each average', () => {
    expect(
      rankedListText('Which customer problem should we solve next?', [
        { solutionId: 'a', text: 'Improve onboarding for first-time users', avg: 82 },
        { solutionId: 'b', text: 'Reduce time to first value', avg: 74 },
      ]),
    ).toBe(
      'Which customer problem should we solve next?\n' +
        '\n' +
        '#1 Improve onboarding for first-time users — 82\n' +
        '#2 Reduce time to first value — 74',
    );
  });

  it('null averages (zero-ballot close) render — never NaN', () => {
    const text = rankedListText('p', [
      { solutionId: 'a', text: 'First', avg: null },
      { solutionId: 'b', text: 'Second', avg: null },
    ]);
    expect(text).toContain('#1 First — —');
    expect(text).toContain('#2 Second — —');
    expect(text).not.toContain('NaN');
  });
});
