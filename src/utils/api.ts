import type {
  ApiResponse,
  Microbe,
  MicrobeCategory,
  Stats,
} from '../../shared/types';
import type {
  Assignment,
  HintReceipt,
  PublicPuzzleLevel,
  PuzzleHint,
  PuzzleVerdict,
} from '../../shared/puzzleTypes';

const API_BASE = '/api';

async function request<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data: ApiResponse<T> = await res.json();
  if (!data.success || !data.data) {
    throw new Error(data.error || '请求失败');
  }
  return data.data;
}

export const api = {
  getMicrobes: (params?: { category?: MicrobeCategory; search?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.offset !== undefined) query.set('offset', String(params.offset));
    const queryStr = query.toString();
    return request<Microbe[]>(`/microbes${queryStr ? `?${queryStr}` : ''}`);
  },

  getMicrobeById: (id: number) => request<Microbe>(`/microbes/${id}`),

  getMicrobesByCategory: (category: MicrobeCategory) => request<Microbe[]>(`/microbes/category/${category}`),

  getRelated: (id: number, limit: number = 4) => request<Microbe[]>(`/microbes/${id}/related?limit=${limit}`),

  getStats: () => request<Stats>('/stats'),

  getPuzzleLevels: () => request<PublicPuzzleLevel[]>('/puzzles'),

  getPuzzleLevel: (levelId: string) => request<PublicPuzzleLevel>(`/puzzles/${levelId}`),

  submitPuzzle: (levelId: string, assignment: Assignment, hintReceipts: HintReceipt[] = []) =>
    request<PuzzleVerdict>('/puzzles/submit', {
      method: 'POST',
      body: JSON.stringify({ levelId, assignment, hintReceipts }),
    }),

  requestPuzzleHint: (levelId: string, assignment: Assignment, elapsedSeconds: number, tier?: 1 | 2 | 3) =>
    request<PuzzleHint>(`/puzzles/${levelId}/hint`, {
      method: 'POST',
      body: JSON.stringify({ assignment, elapsedSeconds, tier }),
    }),
};
