import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../src/shared/contract';
import {
  activeSession,
  filterSessions,
  formatDate,
  formatTime,
  greetingFor,
  recentSessions,
  sortSessions,
} from '../src/client/dashboard';

const summary = (over: Partial<SessionSummary>): SessionSummary => ({
  id: 'id',
  problem: 'Problem',
  workflow: 'crowdsourced',
  phase: 'lobby',
  joinCode: '123456',
  participants: 5,
  cap: 8,
  createdAt: '2024-05-15T10:42:00',
  ...over,
});

const done = summary({ id: 'done', phase: 'results', joinCode: undefined, closedAt: '2024-05-15T11:00:00' });
const older = summary({ id: 'older', createdAt: '2024-05-10T09:05:00' });
const newer = summary({ id: 'newer', createdAt: '2024-05-16T09:05:00' });

describe('activeSession: the dashboard Active-session card', () => {
  it('picks the most recently created live session, whatever the input order', () => {
    expect(activeSession([older, done, newer])?.id).toBe('newer');
    expect(activeSession([newer, older])?.id).toBe('newer');
  });

  it('null when every session is completed (or there are none)', () => {
    expect(activeSession([done])).toBeNull();
    expect(activeSession([])).toBeNull();
  });
});

describe('recentSessions: completed shortcuts under the Active card', () => {
  it('completed sessions only, newest first, capped at three', () => {
    const completed = ['a', 'b', 'c', 'd'].map((id, i) =>
      summary({ id, phase: 'results', createdAt: `2024-05-0${i + 1}T00:00:00`, closedAt: '2024-05-15T11:00:00' }),
    );
    const recent = recentSessions([older, ...completed]);
    expect(recent.map((s) => s.id)).toEqual(['d', 'c', 'b']);
  });
});

describe('filterSessions: History search + All/Live/Completed pills', () => {
  const pricing = summary({ id: 'p', problem: 'Which pricing model should we prioritize?' });
  it('search matches the problem statement, case-insensitively', () => {
    expect(filterSessions([pricing, done], 'PRICING', 'all')).toEqual([pricing]);
    expect(filterSessions([pricing, done], '', 'all')).toEqual([pricing, done]);
  });

  it('Live and Completed pills split on phase = results', () => {
    expect(filterSessions([pricing, done], '', 'live')).toEqual([pricing]);
    expect(filterSessions([pricing, done], '', 'completed')).toEqual([done]);
  });
});

describe('sortSessions: sortable History columns', () => {
  it('date sorts by createdAt in either direction, without mutating the input', () => {
    const input = [older, newer];
    expect(sortSessions(input, 'date', 'desc').map((s) => s.id)).toEqual(['newer', 'older']);
    expect(sortSessions(input, 'date', 'asc').map((s) => s.id)).toEqual(['older', 'newer']);
    expect(input.map((s) => s.id)).toEqual(['older', 'newer']);
  });

  it('problem, participants and state each sort by their column', () => {
    const a = summary({ id: 'a', problem: 'Alpha', participants: 9 });
    const b = summary({ id: 'b', problem: 'beta', participants: 2 });
    expect(sortSessions([b, a], 'problem', 'asc').map((s) => s.id)).toEqual(['a', 'b']);
    expect(sortSessions([a, b], 'participants', 'asc').map((s) => s.id)).toEqual(['b', 'a']);
    // state: live before completed ascending.
    expect(sortSessions([done, a], 'state', 'asc').map((s) => s.id)).toEqual(['a', 'done']);
    expect(sortSessions([a, done], 'state', 'desc').map((s) => s.id)).toEqual(['done', 'a']);
  });
});

describe('greetingFor: time-of-day greeting', () => {
  it('morning before noon, afternoon until 6pm, evening after', () => {
    expect(greetingFor(0)).toBe('Good morning');
    expect(greetingFor(11)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good afternoon');
    expect(greetingFor(18)).toBe('Good evening');
    expect(greetingFor(23)).toBe('Good evening');
  });
});

describe('formatDate/formatTime: the mock "May 15, 2024 · 10:42 AM" rendering', () => {
  it('renders date and time separately', () => {
    expect(formatDate('2024-05-15T10:42:00')).toBe('May 15, 2024');
    expect(formatTime('2024-05-15T10:42:00')).toBe('10:42 AM');
  });
});
