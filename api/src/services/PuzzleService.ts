import crypto from 'node:crypto';
import type {
  Assignment,
  HintReceipt,
  PublicProof,
  PublicPuzzleLevel,
  PuzzleHint,
  PuzzleLevelTemplate,
  PuzzleSpecies,
  PuzzleSubmission,
  PuzzleVerdict,
  SolvabilityProof,
} from '../../../shared/puzzleTypes.js';
import { layoutNetwork, makeBenchmarkGraph } from '../../../shared/forceLayout.js';
import { puzzleLevels } from '../data/puzzleLevels.js';
import {
  evaluateAssignment,
  generateLevel,
  hashCanonicalJson,
  proveShuffleDoesNotChangeSolution,
  validateAssignmentShape,
  type GeneratedPuzzleLevel,
} from './puzzleEngine.js';

const HINT_SECRET = process.env.PUZZLE_HINT_SECRET || 'development-puzzle-hint-secret';

const HINT_PENALTIES = { 1: 10, 2: 20, 3: 35 } as const;

export const generatedPuzzleLevels: GeneratedPuzzleLevel[] = puzzleLevels.map((template) => {
  const generated = generateLevel(template);
  proveShuffleDoesNotChangeSolution(generated);
  return generated;
});

const levelMap = new Map(generatedPuzzleLevels.map((level) => [level.template.id, level]));

function publicProof(proof: SolvabilityProof): PublicProof {
  return {
    levelId: proof.levelId,
    version: proof.version,
    seed: proof.seed,
    generatedBy: proof.generatedBy,
    slotCount: proof.slotCount,
    candidateCount: proof.candidateCount,
    shuffledCandidateOrderHash: hashCanonicalJson({
      levelId: proof.levelId,
      order: proof.shuffledCandidateOrder,
    }),
    witnessFingerprint: proof.witnessFingerprint,
    legalEdgeCount: proof.legalEdgeCount,
    activeNodeCount: proof.activeNodeCount,
    totalNodeCount: proof.totalNodeCount,
    solutionPolicy: proof.solutionPolicy,
    knownMultipleSolutions: proof.knownMultipleSolutions,
    shuffledAssignmentStillSolved: proof.shuffledAssignmentStillSolved,
  };
}

export function listPuzzleLevels(): PublicPuzzleLevel[] {
  return generatedPuzzleLevels.map(toPublicLevel);
}

export function toPublicLevel(generated: GeneratedPuzzleLevel): PublicPuzzleLevel {
  const { template, candidateOrder, proof } = generated;
  const candidateById = new Map(template.speciesCatalog.map((species) => [species.id, species]));
  const candidates = candidateOrder
    .map((id) => candidateById.get(id))
    .filter((species): species is PuzzleSpecies => Boolean(species));

  return {
    id: template.id,
    version: template.version,
    title: template.title,
    scene: template.scene,
    intro: template.intro,
    nodes: [
      ...[...template.resources, ...template.fixedSpecies].map((species) => ({
        id: species.id,
        name: species.name,
        scientificName: species.scientificName,
        kind: species.kind,
        guild: species.guild,
        description: species.description,
        placeholder: false,
      })),
      ...template.slots.map((slot) => ({
        id: slot.id,
        name: slot.label,
        kind: 'consumer' as const,
        guild: slot.acceptsGuild,
        description: slot.clue,
        slotId: slot.id,
        acceptsGuild: slot.acceptsGuild,
        clue: slot.clue,
        placeholder: true,
      })),
    ],
    edges: template.edges,
    slots: template.slots.map(({ id, label, acceptsGuild, clue }) => ({ id, label, acceptsGuild, clue })),
    candidates,
    proof: publicProof(proof),
  };
}

export function getGeneratedLevel(levelId: string): GeneratedPuzzleLevel | undefined {
  return levelMap.get(levelId);
}

export function getPublicLevel(levelId: string): PublicPuzzleLevel | undefined {
  const level = getGeneratedLevel(levelId);
  return level ? toPublicLevel(level) : undefined;
}

/** Internal verification accessor; HTTP routes intentionally expose only the public proof summary. */
export function getGenerationProofs(): SolvabilityProof[] {
  return generatedPuzzleLevels.map((level) => level.proof);
}

export function runLayoutBenchmark() {
  const graph = makeBenchmarkGraph(100, 260);
  const result = layoutNetwork(graph.nodes, graph.links, {
    width: 1200,
    height: 800,
    iterations: 70,
    linkDistance: 92,
  });
  return {
    nodeCount: graph.nodes.length,
    linkCount: graph.links.length,
    ...result,
    performanceBudgetMs: 200,
    withinBudget: result.elapsedMs <= 200,
  };
}

function receiptSignature(receipt: Omit<HintReceipt, 'sig'>): string {
  return crypto.createHmac('sha256', HINT_SECRET).update(hashCanonicalJson(receipt)).digest('hex');
}

export function verifyHintReceipt(level: GeneratedPuzzleLevel, receipt: HintReceipt): boolean {
  if (receipt.levelId !== level.template.id || receipt.version !== level.template.version) return false;
  if (![1, 2, 3].includes(receipt.tier)) return false;
  if (receipt.penalty !== HINT_PENALTIES[receipt.tier]) return false;
  if (!/^[a-f0-9]{16}$/.test(receipt.nonce) || !/^[a-f0-9]{64}$/.test(receipt.sig)) return false;

  const { sig, ...unsigned } = receipt;
  const expected = receiptSignature(unsigned);
  const actualBuffer = Buffer.from(sig, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function uniqueReceipts(level: GeneratedPuzzleLevel, receipts: HintReceipt[] = []): HintReceipt[] {
  const seen = new Set<string>();
  return receipts.filter((receipt) => {
    if (!verifyHintReceipt(level, receipt)) return false;
    const key = `${receipt.tier}:${receipt.nonce}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreFromReceipts(receipts: HintReceipt[]): { score: number; hintPenalty: number } {
  const maxTier = receipts.reduce((max, receipt) => Math.max(max, receipt.tier), 0);
  const hintPenalty = maxTier === 3 ? HINT_PENALTIES[3] : maxTier === 2 ? HINT_PENALTIES[2] : maxTier === 1 ? HINT_PENALTIES[1] : 0;
  return { score: Math.max(0, 100 - hintPenalty), hintPenalty };
}

function verdictHash(level: PuzzleLevelTemplate, submission: PuzzleSubmission, evaluation: ReturnType<typeof evaluateAssignment>, score: number, hintPenalty: number): string {
  return hashCanonicalJson({
    levelId: level.id,
    version: level.version,
    assignment: submission.assignment,
    solved: evaluation.solved,
    complete: evaluation.complete,
    illegalEdgeKeys: evaluation.illegalEdges.map((edge) => `${edge.source}->${edge.target}:${edge.kind}`),
    activeNodeIds: evaluation.activeNodeIds,
    inactiveNodeIds: evaluation.inactiveNodeIds,
    collapsedReasons: evaluation.collapsedNodes.map((node) => `${node.nodeId}:${node.reason}`),
    score,
    hintPenalty,
    // Receipts change the score but forged receipts are rejected; include max tier only.
    hintTier: Math.max(0, ...(submission.hintReceipts ?? []).map((receipt) => receipt.tier)),
  });
}

export function adjudicateSubmission(submission: PuzzleSubmission): PuzzleVerdict | { error: string; statusCode: number } {
  if (!submission || typeof submission !== 'object') return { error: '提交格式非法', statusCode: 400 };
  const level = getGeneratedLevel(String(submission.levelId));
  if (!level) return { error: '关卡不存在或版本已失效', statusCode: 404 };

  const assignment: Assignment = submission.assignment ?? {};
  const shapeError = validateAssignmentShape(level.template, assignment);
  if (shapeError) return { error: shapeError, statusCode: 400 };

  const forged = (submission.hintReceipts ?? []).filter((receipt) => !verifyHintReceipt(level, receipt));
  if (forged.length) return { error: '提示凭证无效，DOM 篡改不会改变服务端裁决', statusCode: 400 };

  const receipts = uniqueReceipts(level, submission.hintReceipts ?? []);
  const evaluation = evaluateAssignment(level.template, assignment);
  const { score, hintPenalty } = scoreFromReceipts(receipts);
  const status = !evaluation.complete
    ? 'incomplete'
    : evaluation.illegalEdges.length > 0
      ? 'illegal'
      : evaluation.solved
        ? 'solved'
        : 'collapsed';

  const message =
    status === 'solved'
      ? level.template.knownMultipleSolutions
        ? '网络成立。本关存在多解，所有服务端验证为合法且不坍塌的完整网络均算通过。'
        : '网络成立，所有物种都获得了可持续支持。'
      : status === 'incomplete'
        ? '网络尚未填满，服务端只给出当前诊断。'
        : status === 'illegal'
          ? '存在非法生态关系，整张网未被承认为候选食物网。'
          : '关系形式合法，但支持流在最小不动点中没有到达所有物种。';

  return {
    ...evaluation,
    status,
    score: status === 'solved' ? score : 0,
    hintPenalty: status === 'solved' ? hintPenalty : 0,
    verdictHash: verdictHash(level.template, submission, evaluation, score, hintPenalty),
    message,
  };
}

function firstEmptyOrWrongSlot(level: GeneratedPuzzleLevel, assignment: Assignment) {
  for (const slot of level.template.slots) {
    if (assignment[slot.id] !== slot.witnessSpeciesId) return slot;
  }
  return level.template.slots[0];
}

function makeReceipt(level: GeneratedPuzzleLevel, tier: 1 | 2 | 3): HintReceipt {
  const receipt = {
    levelId: level.template.id,
    version: level.template.version,
    tier,
    penalty: HINT_PENALTIES[tier],
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  return { ...receipt, sig: receiptSignature(receipt) };
}

export function requestHint(input: {
  levelId: string;
  assignment?: Assignment;
  elapsedSeconds?: number;
  tier?: number;
}): PuzzleHint | { error: string; statusCode: number } {
  const level = getGeneratedLevel(String(input.levelId));
  if (!level) return { error: '关卡不存在', statusCode: 404 };
  const elapsed = Number(input.elapsedSeconds ?? 0);
  if (!Number.isFinite(elapsed) || elapsed < 0) return { error: '计时数据非法', statusCode: 400 };

  // 两分钟以下只给免费的结构性诊断；120 秒后解锁分级提示。
  if (elapsed < 120 && input.tier) {
    return { error: '尚未卡住满两分钟，不能领取会扣分的提示', statusCode: 429 };
  }

  const assignment = input.assignment ?? {};
  const shapeError = validateAssignmentShape(level.template, assignment);
  if (shapeError) return { error: shapeError, statusCode: 400 };

  const evaluation = evaluateAssignment(level.template, assignment);
  const slot = firstEmptyOrWrongSlot(level, assignment);

  let title: string;
  let message: string;

  if (!input.tier && elapsed < 120) {
    return {
      tier: 0,
      penalty: 0,
      title: '免费网络诊断',
      message:
        evaluation.illegalEdges[0]
          ? `先处理非法关系：${evaluation.illegalEdges[0].reason}。这条诊断不扣分。`
          : evaluation.collapsedNodes[0]?.reason === 'deadlocked'
            ? '有一组节点只在彼此之间寻找支持，循环外缺少已激活的非生物源。这条诊断不扣分。'
            : evaluation.collapsedNodes[0]
              ? '至少一个物种缺少可达碳源；从固定资源沿合法边重新追踪。这条诊断不扣分。'
              : '当前网络没有坍塌；填满所有空位后再提交。这条诊断不扣分。',
    };
  }

  const requested = Number(input.tier ?? 1);
  if (![1, 2, 3].includes(requested)) return { error: '提示等级非法', statusCode: 400 };
  const tier = requested as 1 | 2 | 3;

  if (tier === 1) {
    title = '一级提示：定位功能角色（-10 分）';
    message = `检查「${slot.label}」：它需要的角色是“${slot.acceptsGuild}”。先根据碳源和产物筛掉生态位不符的物种。`;
  } else if (tier === 2) {
    title = '二级提示：给出局部判据（-20 分）';
    message = `「${slot.label}」的判据：${slot.clue} 只沿一条支持边验证，不要根据名字或外观猜测。`;
  } else {
    title = '三级提示：强引导但不显示答案（-35 分）';
    const candidates = slot.accepts
      .map((id) => level.template.speciesCatalog.find((species) => species.id === id))
      .filter((species): species is PuzzleSpecies => Boolean(species));
    const wrong = candidates.find((species) => species.id !== slot.witnessSpeciesId);
    message = `「${slot.label}」应保留能匹配“${slot.clue}”的候选；例如「${wrong?.name ?? candidates[0]?.name}」缺少完整关系，不只是位置问题。仍需你自己拖入正确物种。`;
  }

  return { tier, penalty: HINT_PENALTIES[tier], title, message, receipt: makeReceipt(level, tier) };
}
