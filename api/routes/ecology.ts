import { Router } from 'express';
import { ECOLOGY_LEVELS } from '../src/data/ecologyLevels.js';
import {
  buildHint,
  generatePuzzle,
  gradeSession,
  hintPolicy,
  RULES_VERSION,
  type PuzzleSession,
} from '../src/services/ecologyEngine.js';
import type { Submission } from '../../shared/ecology.js';

export const ecologyRouter = Router();

const sessions = new Map<string, PuzzleSession>();
const DEFAULT_SEEDS: Record<string, string> = {
  'vent-sulfur-cycle': 'vent-seed-2026-09-20',
  'gut-cross-feeding': 'gut-seed-2026-09-20',
  'forest-mycorrhizal-web': 'forest-seed-2026-09-20',
};

function getLevel(levelId: string) {
  return ECOLOGY_LEVELS.find((level) => level.id === levelId);
}

function createSession(levelId: string, seed?: string): PuzzleSession {
  const level = getLevel(levelId);
  if (!level) throw new Error('LEVEL_NOT_FOUND');
  const actualSeed = seed ?? DEFAULT_SEEDS[levelId] ?? `seed:${levelId}`;
  const { puzzle, proof, level: shuffledLevel } = generatePuzzle(level, actualSeed);
  const session: PuzzleSession = {
    puzzleId: puzzle.puzzleId,
    levelId,
    level: shuffledLevel,
    publicPuzzle: puzzle,
    proof,
    createdAt: Date.now(),
    usedHints: {},
    hintPenalty: 0,
  };
  sessions.set(session.puzzleId, session);
  return session;
}

ecologyRouter.get('/ecology/levels', (_req, res) => {
  res.json({
    success: true,
    data: ECOLOGY_LEVELS.map((level) => ({
      id: level.id,
      name: level.name,
      biome: level.biome,
      summary: level.summary,
      source: level.source,
      blankCount: level.slots.filter((slot) => !slot.locked).length,
      nodeCount: level.slots.length,
    })),
  });
});

ecologyRouter.post('/ecology/puzzles', (req, res) => {
  const levelId = String(req.body?.levelId ?? '');
  const seed = typeof req.body?.seed === 'string' ? req.body.seed.slice(0, 128) : undefined;
  const level = getLevel(levelId);
  if (!level) {
    res.status(404).json({ success: false, error: '关卡不存在' });
    return;
  }
  const session = createSession(levelId, seed);
  res.json({
    success: true,
    data: {
      ...session.publicPuzzle,
      serverTime: session.createdAt,
      hintSchedule: {
        tier1AfterMs: 120_000,
        tier2AfterMs: 180_000,
        tier3AfterMs: 240_000,
        penalties: { tier1: 5, tier2: 10, tier3: 20 },
      },
      proofCommitment: {
        levelConstraintHash: session.proof.invariantHashes.levelConstraintHash,
        shuffledConstraintHash: session.proof.invariantHashes.shuffledConstraintHash,
        witnessVerdict: session.proof.witnessVerdict,
        solverSolutionCount: session.proof.solverSolutionCount,
        solverSolutionLimit: session.proof.solverSolutionLimit,
        rulesVersion: RULES_VERSION,
        soundnessChecks: session.proof.soundnessChecks,
      },
    },
  });
});

ecologyRouter.post('/ecology/hints', (req, res) => {
  const puzzleId = String(req.body?.puzzleId ?? '');
  const slotId = String(req.body?.slotId ?? '');
  const tier = Number(req.body?.tier) as 1 | 2 | 3;
  const session = sessions.get(puzzleId);
  if (!session) {
    res.status(404).json({ success: false, error: '谜题不存在或已过期，请重新开局' });
    return;
  }
  if (![1, 2, 3].includes(tier)) {
    res.status(400).json({ success: false, error: '提示等级必须是 1、2 或 3' });
    return;
  }
  const result = buildHint(session, slotId, tier);
  if (!result.allowed) {
    res.status(403).json({
      success: false,
      error: 'reason' in result && result.reason === 'invalid-slot' ? '提示目标不是可填空位' : '提示尚未解锁',
      data: 'retryAfterMs' in result ? { retryAfterMs: result.retryAfterMs } : undefined,
    });
    return;
  }
  res.json({ success: true, data: result });
});

ecologyRouter.post('/ecology/grade', (req, res) => {
  const submission = req.body as Submission;
  const session = sessions.get(submission?.puzzleId);
  if (!session) {
    res.status(404).json({ success: false, error: '谜题不存在或已过期，请重新开局' });
    return;
  }
  if (!submission.assignment || typeof submission.assignment !== 'object' || Array.isArray(submission.assignment)) {
    res.status(400).json({ success: false, error: 'assignment 必须是 slotId -> speciesId 的对象' });
    return;
  }
  const result = gradeSession(session, submission.assignment);
  res.json({ success: true, data: result });
});

ecologyRouter.get('/ecology/hint-policy', (req, res) => {
  const elapsed = Number(req.query.elapsedMs ?? 0);
  res.json({
    success: true,
    data: {
      tiers: ([1, 2, 3] as const).map((tier) => ({ tier, ...hintPolicy(elapsed, tier) })),
    },
  });
});

export { createSession, sessions as ecologySessions, getLevel as getEcologyLevel };
