import { SCORE_MAX, SCORE_MIN, type Ack, type SessionState } from '../shared/contract';
import type { Emit } from './create-session';

type Deck = NonNullable<SessionState['deck']>;
export type Scores = Record<string, number>;

/** Drag vector from the ring centre → 0–100. Anchors per mock 08: left = 0 Reject,
 *  top = 50 Unsure, right = 100 Strong confidence; below the horizontal clamps to
 *  the nearest anchor. Screen coords (y grows downward). */
export function angleToScore(dx: number, dy: number): number {
  if (dy >= 0) return dx < 0 ? SCORE_MIN : SCORE_MAX;
  const theta = Math.atan2(-dy, dx); // 0 at right → π at left
  return Math.round((1 - theta / Math.PI) * SCORE_MAX);
}

/** Live feedback colour: reject red, unsure amber, confident green (mock 08). */
export function scoreColor(score: number): string {
  if (score < 35) return '#dc2626';
  if (score <= 65) return '#d97706';
  return '#16a34a';
}

/** First deck index without a score — where a (resumed) voter picks up; deck.length = done. */
export function nextUnscored(deck: Deck, scores: Scores): number {
  const i = deck.findIndex((d) => !(d.id in scores));
  return i === -1 ? deck.length : i;
}

/** Drop scores for solutions not in this deck (stale device storage from another deck). */
export function pruneScores(deck: Deck, scores: Scores): Scores {
  const ids = new Set(deck.map((d) => d.id));
  return Object.fromEntries(Object.entries(scores).filter(([id]) => ids.has(id)));
}

// Device-local per-card scores — a mid-deck refresh resumes at the next unscored card
// (server holds no partial state; contract).
const storageKey = (sessionId: string) => `ballot-${sessionId}`;

export function loadScores(sessionId: string): Scores {
  try {
    return JSON.parse(localStorage.getItem(storageKey(sessionId)) ?? '{}');
  } catch {
    return {};
  }
}

export function saveScores(sessionId: string, scores: Scores): void {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(scores));
  } catch {
    // ponytail: private-mode/quota failures just lose resume-on-refresh, never the ballot
  }
}

export function clearScores(sessionId: string): void {
  try {
    localStorage.removeItem(storageKey(sessionId));
  } catch {}
}

/** One atomic ballot for the exact deck. ok / duplicate-ballot → 'submitted' (counted);
 *  bad-phase (raced voting:close) → 'ended' — route to results, never an error;
 *  incomplete-ballot → 'incomplete' so the UI resumes at the missing card. Others throw. */
export async function submitBallot(emit: Emit, scores: Scores): Promise<'submitted' | 'ended' | 'incomplete'> {
  const ack = (await emit('ballot:submit', { scores })) as Ack;
  if ('ok' in ack || ack.error === 'duplicate-ballot') return 'submitted';
  if (ack.error === 'bad-phase') return 'ended';
  if (ack.error === 'incomplete-ballot') return 'incomplete';
  throw new Error(ack.error);
}
