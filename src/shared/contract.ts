// Shared seam contract — the ONE module server and client both import.
// Shapes and vocabulary per docs/CONTRACTS.md.

export type Workflow = 'crowdsourced' | 'preset';
export type Phase = 'lobby' | 'curation' | 'voting' | 'results';

export type ErrorCode =
  | 'profile-required'
  | 'not-found'
  | 'session-full'
  | 'voting-started'
  | 'not-host'
  | 'bad-phase'
  | 'not-participant'
  | 'already-submitted'
  | 'duplicate-ballot'
  | 'incomplete-ballot'
  | 'empty-deck'
  | 'invalid-input';

export type Ack<T = {}> = ({ ok: true } & T) | { error: ErrorCode };

export type SessionState = {
  sessionId: string;
  joinCode?: string; // absent at results — the code recycles
  problem: string;
  workflow: Workflow;
  phase: Phase;
  participants: { count: number; cap: number };
  isHost: boolean;
  hostParticipates: boolean;
  me: { submitted: boolean; voted: boolean; submissionText?: string };
  submissions?: { submitted: number; total: number };
  deck?: { id: string; text: string; combined: boolean }[];
  votingProgress?: { voted: number; total: number };
  roster?: { displayName: string; voted: boolean }[];
  results?: { ranked: { solutionId: string; text: string; avg: number }[] };
};

// Demographic enums — provisional per docs/CONTRACTS.md (swap when #25 resolves).
export const DEPARTMENTS = ['Product', 'Engineering', 'Sales', 'Marketing', 'Operations', 'Other'] as const;
export const ROLES = ['Individual Contributor', 'Team Lead', 'Manager', 'Director', 'Executive'] as const;
export const TENURES = ['<1 year', '1–2 years', '2–5 years', '5–10 years', '10+ years'] as const;

export type Department = (typeof DEPARTMENTS)[number];
export type Role = (typeof ROLES)[number];
export type Tenure = (typeof TENURES)[number];

export type Profile = { department: Department; role: Role; tenure: Tenure };

export const CAP_MIN = 2;
export const CAP_MAX = 100;
export const CAP_DEFAULT = 8;
export const PROBLEM_MAX_LENGTH = 500;
export const SOLUTION_MAX_LENGTH = 300;
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

// Cohort cells with fewer than N ballots are suppressed.
export const SUPPRESSION_N = 3;

// Consensus badge, client-derived from spread width w = p75 − p25.
export const CONSENSUS_STRONG_MAX_WIDTH = 30; // w ≤ 30 → strong consensus
export const CONSENSUS_POLARISED_MIN_WIDTH = 50; // w ≥ 50 → polarised
