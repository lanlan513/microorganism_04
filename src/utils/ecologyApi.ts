const API_BASE = '/api';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
    body: init?.body,
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new Error(payload.error || '请求失败');
  }
  return payload.data as T;
}

export const ecologyApi = {
  levels: () => request<Array<{ id: string; name: string; biome: string; summary: string; source: string; blankCount: number; nodeCount: number }>>('/ecology/levels'),
  puzzle: (levelId: string) => request<EcologyPuzzleResponse>('/ecology/puzzles', {
    method: 'POST',
    body: JSON.stringify({ levelId }),
  }),
  grade: (submission: { puzzleId: string; assignment: Record<string, string> }) => request<EcologyGrade>('/ecology/grade', {
    method: 'POST',
    body: JSON.stringify(submission),
  }),
  hint: (payload: { puzzleId: string; slotId: string; tier: 1 | 2 | 3 }) => request<EcologyHint>('/ecology/hints', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
};

export interface EcologyPuzzleResponse {
  puzzleId: string;
  levelId: string;
  name: string;
  summary: string;
  source: string;
  slots: Array<{ slotId: string; label: string; locked: boolean; lockedSpeciesId?: string; x: number; y: number }>;
  edges: Array<{ id: string; source: string; target: string; relation: string; description: string }>;
  bank: Array<{ id: string; name: string; latin?: string; kind: string; role: string }>;
  lockedSpecies: Array<{ id: string; name: string; latin?: string; kind: string; role: string }>;
  blankCount: number;
  serverTime: number;
  hintSchedule: { tier1AfterMs: number; tier2AfterMs: number; tier3AfterMs: number; penalties: Record<string, number> };
  proofCommitment: {
    levelConstraintHash: string;
    shuffledConstraintHash: string;
    witnessVerdict: string;
    solverSolutionCount: number | string;
    solverSolutionLimit: number;
    rulesVersion: string;
    soundnessChecks: string[];
  };
}

export interface EcologyGrade {
  verdict: 'accepted' | 'rejected';
  score: number;
  baseScore: number;
  hintPenalty: number;
  invalidRelations: Array<{ edgeId: string; relation: string; source: string; target: string; reason: string }>;
  nodeFailures: Array<{ slotId: string; speciesId: string; name: string; reason: string; detail: string; cycle?: string[] }>;
  activeSlots: string[];
  solver: { solutionCount: number | string; solutionCountLimit: number; checkedBy: string };
  rulesVersion: string;
  decisionHash: string;
  message: string;
}

export interface EcologyHint {
  tier: 1 | 2 | 3;
  penalty: number;
  totalPenalty?: number;
  message: string;
}
