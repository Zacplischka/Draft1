import type { SessionState } from '../shared/contract';

export type Ranked = NonNullable<SessionState['results']>['ranked'];

/** Plain-text Ranked list for the clipboard (mock 10's Copy Ranked list).
 *  Null averages (zero-ballot close) print as "—", mirroring the screen. */
export function rankedListText(problem: string, ranked: Ranked): string {
  return [problem, '', ...ranked.map((r, i) => `#${i + 1} ${r.text} — ${r.avg ?? '—'}`)].join('\n');
}
