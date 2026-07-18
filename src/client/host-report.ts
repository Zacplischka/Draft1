import {
  CONSENSUS_POLARISED_MIN_WIDTH,
  CONSENSUS_STRONG_MAX_WIDTH,
  DEPARTMENTS,
  ROLES,
  TENURES,
  type HostReport,
} from '../shared/contract';
import { authedFetch } from './auth';

export type DimensionKey = 'department' | 'role' | 'tenure';

export const DIMENSIONS: { key: DimensionKey; label: string }[] = [
  { key: 'department', label: 'Department' },
  { key: 'role', label: 'Role' },
  { key: 'tenure', label: 'Tenure' },
];

const COHORT_ORDER: Record<DimensionKey, readonly string[]> = {
  department: DEPARTMENTS,
  role: ROLES,
  tenure: TENURES,
};

export type Consensus = 'strong' | 'mixed' | 'polarised';

/** Client-derived consensus badge from spread width w = p75 − p25 (docs/CONTRACTS.md). */
export function consensus(p25: number, p75: number): Consensus {
  const w = p75 - p25;
  if (w <= CONSENSUS_STRONG_MAX_WIDTH) return 'strong';
  return w >= CONSENSUS_POLARISED_MIN_WIDTH ? 'polarised' : 'mixed';
}

export const consensusLabel: Record<Consensus, string> = {
  strong: 'Strong consensus',
  mixed: 'Mixed',
  polarised: 'Polarised',
};

/** Heatmap columns in shared-enum order; cohorts the enum doesn't know (a future #25
 *  value swap) go last rather than disappearing. */
export function orderCohorts(dim: DimensionKey, present: string[]): string[] {
  const order = COHORT_ORDER[dim];
  return [...order.filter((c) => present.includes(c)), ...present.filter((c) => !order.includes(c))];
}

/** Heatmap colour-scale bucket for a cell value. */
export function cellTone(value: number): 'high' | 'mid' | 'low' {
  return value >= 70 ? 'high' : value >= 40 ? 'mid' : 'low';
}

/** GET /api/sessions/:id/report — bearer-authenticated (docs/CONTRACTS.md HTTP section). */
export async function fetchReport(sessionId: string): Promise<HostReport> {
  return (await (await authedFetch(`/api/sessions/${sessionId}/report`)).json()) as HostReport;
}

/** The CSV endpoint authenticates by bearer header, which a plain <a href> cannot send —
 *  download via authenticated fetch → blob → object-URL (docs/CONTRACTS.md). */
export async function downloadReportCsv(sessionId: string): Promise<void> {
  const res = await authedFetch(`/api/sessions/${sessionId}/report.csv`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = 'group-decision-report.csv';
  a.click();
  URL.revokeObjectURL(url);
}
