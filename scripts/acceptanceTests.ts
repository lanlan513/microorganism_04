import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ECOLOGY_LEVELS } from '../api/src/data/ecologyLevels.js';
import {
  constraintHash,
  generatePuzzle,
  gradeAssignment,
  gradeSession,
  generatePuzzle,
  registerFixtureSpecies,
  solve,
} from '../api/src/services/ecologyEngine.js';
import { layoutGraph, makeBenchmarkGraph } from '../shared/graphLayout.js';
import type { PuzzleSession } from '../api/src/services/ecologyEngine.js';
import type { EcologyLevel } from '../shared/ecology.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = join(root, 'acceptance-artifacts');
mkdirSync(artifactDir, { recursive: true });

function sessionFor(level: EcologyLevel, seed = 'acceptance-seed'): PuzzleSession {
  const { puzzle, proof, level: shuffledLevel } = generatePuzzle(level, seed);
  return {
    puzzleId: puzzle.puzzleId,
    levelId: level.id,
    level: shuffledLevel,
    publicPuzzle: puzzle,
    proof,
    createdAt: 0,
    usedHints: {},
    hintPenalty: 0,
  };
}

test('生成期证明：三关在洗牌后均可由独立求解器证明至少有一个解', () => {
  const proofs = ECOLOGY_LEVELS.map((level) => {
    const seed = `proof-${level.id}`;
    const generated = generatePuzzle(level, seed);
    const proof = generated.proof;
    assert.equal(proof.witnessVerdict, 'accepted');
    assert.ok(['many', 1, 2].includes(proof.solverSolutionCount));
    assert.equal(proof.invariantHashes.levelConstraintHash, constraintHash(level));
    assert.equal(proof.invariantHashes.levelConstraintHash, proof.invariantHashes.shuffledConstraintHash);
    const replay = gradeAssignment(generated.level, proof.witness);
    assert.equal(replay.verdict, 'accepted');
    assert.equal(replay.baseScore, 100);
    return proof;
  });
  writeFileSync(join(artifactDir, 'solvability-proofs.json'), JSON.stringify(proofs, null, 2));
});

test('服务端裁决：同一份提交无论交多少次，分数、结论与决策哈希完全一致', () => {
  const level = ECOLOGY_LEVELS[0];
  const session = sessionFor(level);
  const submission = { ...session.proof.witness };
  const first = gradeSession(session, submission);
  const second = gradeSession(session, submission);
  assert.equal(first.verdict, 'accepted');
  assert.equal(second.verdict, 'accepted');
  assert.equal(first.decisionHash, second.decisionHash);
  assert.deepEqual(first, second);
  writeFileSync(join(artifactDir, 'deterministic-grade.json'), JSON.stringify({
    assignment: submission,
    first,
    second,
    assertion: 'deepEqual(first, second) && first.decisionHash === second.decisionHash',
  }, null, 2));
});

test('非法关系：把深海自养菌换成跨生态系统物种会产生非法输入关系', () => {
  const level = ECOLOGY_LEVELS[0];
  const bad = { ...level.slots.filter((slot) => !slot.locked).reduce<Record<string, string>>((acc, slot) => {
    acc[slot.slotId] = slot.canonicalSpeciesId;
    return acc;
  }, {}) };
  const producerSlot = level.slots.find((slot) => slot.canonicalSpeciesId === 'sulfurovum')!.slotId;
  bad[producerSlot] = 'glomus';
  const result = gradeAssignment(level, bad);
  assert.equal(result.verdict, 'rejected');
  assert.ok(result.invalidRelations.some((item) => item.reason.includes('不属于本关生态系统')));
});

test('死锁：两个无外部碳源的互养伙伴互相等待时，最小不动点不会把它们激活', () => {
  const tinyLevel: EcologyLevel = {
    id: 'synthetic-deadlock',
    name: '合成死锁用例',
    biome: 'synthetic',
    summary: '',
    source: 'acceptance fixture',
    lockedSpeciesIds: [],
    distractors: [],
    species: [
      {
        id: 'dead-a', name: '等待者 A', kind: 'microbe', role: '', biome: 'synthetic', strategy: 'heterotroph',
        consumes: ['b-carbon'], produces: ['a-carbon'], tags: ['a'],
      },
      {
        id: 'dead-b', name: '等待者 B', kind: 'microbe', role: '', biome: 'synthetic', strategy: 'heterotroph',
        consumes: ['a-carbon'], produces: ['b-carbon'], tags: ['b'],
      },
    ],
    slots: [
      { slotId: 'a', canonicalSpeciesId: 'dead-a', label: 'A', locked: false, x: 0, y: 0 },
      { slotId: 'b', canonicalSpeciesId: 'dead-b', label: 'B', locked: false, x: 1, y: 0 },
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b', relation: 'syntrophy', resource: 'a-carbon', description: 'A 给 B' },
      { id: 'ba', source: 'b', target: 'a', relation: 'syntrophy', resource: 'b-carbon', description: 'B 给 A' },
    ],
  };
  registerFixtureSpecies(tinyLevel.species);
  const result = gradeAssignment(tinyLevel, { a: 'dead-a', b: 'dead-b' });
  assert.equal(result.verdict, 'rejected');
  assert.ok(result.nodeFailures.some((failure) => failure.reason === 'deadlock-cycle'));
});

test('多解策略：所有满足完整生态约束的替代放置都算通过，而不是只认标准答案', () => {
  for (const level of ECOLOGY_LEVELS) {
    const result = solve(level, 2);
    assert.ok(result.count >= 1, `${level.id} should be solvable`);
    for (const solution of result.solutions) {
      assert.equal(gradeAssignment(level, solution).verdict, 'accepted');
    }
  }
});

test('布局性能：100 个节点的确定性布局实测中位耗时低于 200ms 且无重叠', () => {
  const graph = makeBenchmarkGraph(100, 160);
  const runs = Array.from({ length: 15 }, () => layoutGraph(graph.nodes, graph.edges, {
    width: 1200,
    height: 760,
    iterations: 42,
    radius: 13,
  }));
  const times = runs.map((run) => run.elapsedMs).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const result = {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    runs: times,
    medianMs: median,
    maxMs: times[times.length - 1],
    converged: runs.every((run) => run.converged),
    overlapCount: Math.max(...runs.map((run) => run.overlapCount)),
    iterations: runs[0].iterations,
    budgetMs: 200,
  };
  writeFileSync(join(artifactDir, 'layout-100-nodes.json'), JSON.stringify(result, null, 2));
  assert.ok(median < 200, `median layout took ${median}ms`);
  assert.equal(result.overlapCount, 0);
  assert.equal(result.converged, true);
});
