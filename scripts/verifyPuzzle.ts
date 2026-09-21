import assert from 'node:assert/strict';
import {
  adjudicateSubmission,
  getGenerationProofs,
  getGeneratedLevel,
  runLayoutBenchmark,
} from '../api/src/services/PuzzleService.ts';
import type { PuzzleLevelTemplate } from '../shared/puzzleTypes.ts';
import { evaluateAssignment } from '../api/src/services/puzzleEngine.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

console.log('1. 生成期可解性证明');
const proofs = getGenerationProofs();
assert.ok(proofs.length >= 3, 'expected three seeded ecosystem levels');
for (const proof of proofs) {
  check(`${proof.levelId}: witness legal and every node active`, () => {
    assert.equal(proof.generatedBy, 'constructive-witness-and-least-fixed-point');
    assert.equal(proof.slotCount, Object.keys(proof.witnessAssignment).length);
    assert.equal(proof.activeNodeCount, proof.totalNodeCount);
    assert.equal(proof.legalEdgeCount > 0, true);
    assert.equal(proof.shuffledAssignmentStillSolved, true);
    const verdict = adjudicateSubmission({
      levelId: proof.levelId,
      assignment: clone(proof.witnessAssignment),
    });
    assert.equal('error' in verdict, false);
    if (!('error' in verdict)) {
      assert.equal(verdict.status, 'solved');
      assert.equal(verdict.solved, true);
      assert.deepEqual(verdict.illegalEdges, []);
      assert.deepEqual(verdict.collapsedNodes, []);
    }
  });
}

console.log('\n2. 洗牌不改变解');
for (const proof of proofs) {
  check(`${proof.levelId}: candidate order is presentation-only`, () => {
    const reversedAssignment = Object.fromEntries(
      Object.entries(proof.witnessAssignment).sort(([a], [b]) => b.localeCompare(a))
    );
    const verdict = adjudicateSubmission({ levelId: proof.levelId, assignment: reversedAssignment });
    assert.equal('error' in verdict, false);
    if (!('error' in verdict)) assert.equal(verdict.solved, true);
  });
}

console.log('\n3. 同一提交两次结论一致');
const first = proofs[0];
const validSubmission = { levelId: first.levelId, assignment: clone(first.witnessAssignment) };
const firstVerdict = adjudicateSubmission(clone(validSubmission));
const secondVerdict = adjudicateSubmission(clone(validSubmission));
check('identical valid submission has identical verdict hash and status', () => {
  assert.equal('error' in firstVerdict, false);
  assert.equal('error' in secondVerdict, false);
  if (!('error' in firstVerdict) && !('error' in secondVerdict)) {
    assert.equal(secondVerdict.verdictHash, firstVerdict.verdictHash);
    assert.equal(secondVerdict.status, firstVerdict.status);
    assert.equal(secondVerdict.score, firstVerdict.score);
  }
});

const invalidAssignment = clone(first.witnessAssignment);
const firstSlot = Object.keys(invalidAssignment)[0];
const invalidCandidates = getGeneratedLevel(first.levelId)!.template.slots
  .find((slot) => slot.id === firstSlot)!.accepts
  .filter((candidateId) => candidateId !== invalidAssignment[firstSlot]);
const invalidCandidatesResults = invalidCandidates.map((candidateId) => {
  const candidateAssignment = { ...invalidAssignment, [firstSlot]: candidateId };
  const candidateVerdict = adjudicateSubmission({ levelId: first.levelId, assignment: candidateAssignment });
  return { candidateId, failed: 'error' in candidateVerdict || candidateVerdict.solved === false };
});
invalidAssignment[firstSlot] = invalidCandidatesResults.find((item) => item.failed)!.candidateId;
const invalidSubmission = { levelId: first.levelId, assignment: invalidAssignment };
const invalidA = adjudicateSubmission(clone(invalidSubmission));
const invalidB = adjudicateSubmission(clone(invalidSubmission));
check('identical invalid submission also has identical deterministic verdict', () => {
  assert.equal('error' in invalidA, false);
  assert.equal('error' in invalidB, false);
  if (!('error' in invalidA) && !('error' in invalidB)) {
    assert.equal(invalidB.verdictHash, invalidA.verdictHash);
    assert.notEqual(invalidA.status, 'solved');
  }
});

console.log('\n4. 边界：非法关系、死锁和多解政策');
check('misplaced gut roles are rejected as illegal relationships', () => {
  const gutLevel = getGeneratedLevel('human-gut-microbiome')!;
  const swappedRoles: Record<string, string> = {
    ...gutLevel.proof.witnessAssignment,
    'slot-fiber-primary-degrader': 'akkermansia',
    'slot-mucus-recycler': 'bacteroides-thetaiotaomicron',
  };
  const verdict = adjudicateSubmission({ levelId: gutLevel.template.id, assignment: swappedRoles });
  assert.equal('error' in verdict, false);
  if (!('error' in verdict)) {
    assert.equal(verdict.status, 'illegal');
    assert.ok(verdict.illegalEdges.length > 0);
    assert.ok(verdict.collapsedNodes.some((node) => node.reason === 'starved'));
  }
});

check('pure mutual wait without abiotic activation is reported as deadlock', () => {
  const minimalTemplate: PuzzleLevelTemplate = {
    id: 'synthetic-deadlock',
    version: 1,
    title: 'deadlock fixture',
    scene: '',
    intro: '',
    resources: [],
    fixedSpecies: [],
    speciesCatalog: [
      { id: 'a', name: 'A', kind: 'producer' as const, guild: 'a', description: '', requires: ['b-carbon'], provides: ['a-carbon'] },
      { id: 'b', name: 'B', kind: 'producer' as const, guild: 'b', description: '', requires: ['a-carbon'], provides: ['b-carbon'] },
    ],
    slots: [
      { id: 'slot-a', label: 'A', acceptsGuild: 'a', accepts: ['a'], clue: '', witnessSpeciesId: 'a' },
      { id: 'slot-b', label: 'B', acceptsGuild: 'b', accepts: ['b'], clue: '', witnessSpeciesId: 'b' },
    ],
    edges: [
      { source: 'slot-a', target: 'slot-b', kind: 'cross-feeding' as const, label: 'A gives carbon' },
      { source: 'slot-b', target: 'slot-a', kind: 'cross-feeding' as const, label: 'B gives carbon' },
    ],
    knownMultipleSolutions: false,
  };
  const verdict = evaluateAssignment(minimalTemplate, { 'slot-a': 'a', 'slot-b': 'b' });
  assert.equal(verdict.solved, false);
  assert.ok(verdict.collapsedNodes.some((node) => node.reason === 'deadlocked' && node.cycleNodeIds?.length === 2));
});

const forestProof = proofs.find((proof) => proof.knownMultipleSolutions);
check('forest level accepts swapped tree-host assignments', () => {
  assert.ok(forestProof, 'forest multi-solution level should exist');
  const swapped = clone(forestProof!.witnessAssignment);
  [swapped['slot-tree-a'], swapped['slot-tree-b']] = [swapped['slot-tree-b'], swapped['slot-tree-a']];
  const verdict = adjudicateSubmission({ levelId: forestProof!.levelId, assignment: swapped });
  assert.equal('error' in verdict, false);
  if (!('error' in verdict)) assert.equal(verdict.solved, true);
});

console.log('\n5. 100 节点布局耗时');
const benchmark = runLayoutBenchmark();
check(`layout completed in ${benchmark.elapsedMs.toFixed(2)}ms (<=200ms)`, () => {
  assert.equal(benchmark.nodeCount, 100);
  assert.ok(benchmark.linkCount >= 100);
  assert.equal(benchmark.collisionFree, true);
  assert.equal(benchmark.withinBudget, true, `layout took ${benchmark.elapsedMs}ms`);
});

console.log(`\nAll ${passed} assertions passed.`);
console.log(
  JSON.stringify(
    {
      proofs: proofs.map((proof) => ({
        levelId: proof.levelId,
        slotCount: proof.slotCount,
        activeNodeCount: proof.activeNodeCount,
        totalNodeCount: proof.totalNodeCount,
        shuffledAssignmentStillSolved: proof.shuffledAssignmentStillSolved,
      })),
      layout: {
        nodeCount: benchmark.nodeCount,
        linkCount: benchmark.linkCount,
        iterations: benchmark.iterations,
        elapsedMs: Number(benchmark.elapsedMs.toFixed(2)),
        collisionFree: benchmark.collisionFree,
        withinBudget: benchmark.withinBudget,
      },
    },
    null,
    2
  )
);
