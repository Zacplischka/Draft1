import { useEffect, useState } from 'react';
import type { Phase, SessionSummary, Workflow } from '../shared/contract';
import { getToken } from './auth';

// live = anything the join code still resolves; completed = results (report available).
export const isLive = (s: SessionSummary) => s.phase !== 'results';

export const phaseLabel = (phase: Phase) => phase[0]!.toUpperCase() + phase.slice(1);
export const workflowLabel = (w: Workflow) => (w === 'preset' ? 'Preset' : 'Crowdsourced');

/** The Active-session card: the most recently created live session (issue #22 AC). */
export function activeSession(sessions: SessionSummary[]): SessionSummary | null {
  const live = sessions.filter(isLive);
  if (!live.length) return null;
  return live.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
}

/** Completed sessions for the home shortcuts — newest first, capped at three. */
export function recentSessions(sessions: SessionSummary[]): SessionSummary[] {
  return sessions
    .filter((s) => !isLive(s))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
}

export type StateFilter = 'all' | 'live' | 'completed';

/** History search (problem statement, case-insensitive) + All/Live/Completed pills. */
export function filterSessions(sessions: SessionSummary[], query: string, filter: StateFilter): SessionSummary[] {
  const q = query.trim().toLowerCase();
  return sessions.filter(
    (s) =>
      (filter === 'all' || (filter === 'live') === isLive(s)) &&
      (!q || s.problem.toLowerCase().includes(q)),
  );
}

export type SortKey = 'date' | 'problem' | 'workflow' | 'participants' | 'state';
export type SortDir = 'asc' | 'desc';

const sortValue = (s: SessionSummary, key: SortKey): string | number => {
  if (key === 'date') return s.createdAt;
  if (key === 'problem') return s.problem.toLowerCase();
  if (key === 'workflow') return s.workflow;
  if (key === 'participants') return s.participants;
  return isLive(s) ? 0 : 1; // state: live before completed ascending
};

export function sortSessions(sessions: SessionSummary[], key: SortKey, dir: SortDir): SessionSummary[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...sessions].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    return sign * (va < vb ? -1 : va > vb ? 1 : 0);
  });
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** GET /api/sessions — bearer-authenticated, like the report endpoints (docs/CONTRACTS.md). */
export async function fetchSessions(): Promise<SessionSummary[]> {
  const token = await getToken();
  if (!token) throw new Error('signed out');
  const res = await fetch('/api/sessions', { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as SessionSummary[];
}

/** Dashboard data: fetched on mount, on window focus, and every 30s — the dashboard
 *  has no socket push (issue #22). Stale data is kept on a failed refresh. */
export function useSessions(): { sessions: SessionSummary[] | null; error: boolean } {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    const load = () =>
      void fetchSessions().then(
        (list) => {
          if (disposed) return;
          setSessions(list);
          setError(false);
        },
        () => {
          if (!disposed) setError(true);
        },
      );
    load();
    const timer = setInterval(load, 30_000);
    window.addEventListener('focus', load);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, []);
  return { sessions, error };
}
