import { createHash } from 'node:crypto';
import type {
  EcologyLevel,
  EdgeViolation,
  GradeResult,
  NodeFailure,
  PublicPuzzle,
  RelationType,
  SolvabilityProof,
  Species,
  Submission,
} from '../../../shared/ecology.js';
import { SPECIES_BY_ID } from '../data/ecologyLevels.js';

export const RULES_VERSION = 'ecology-rules-1.0.0';
const SOLUTION_LIMIT = 2;
const FULL_MARKS = 100;

export interface PuzzleSession {
  puzzleId: string;
  levelId: string;
  level: EcologyLevel;
  publicPuzzle: PublicPuzzle;
  proof: SolvabilityProof;
  createdAt: number;
  usedHints: Record<string, Set<1 | 2 | 3>>;
  hintPenalty: number;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  return Number.parseInt(sha256(seed).slice(0, 8), 16);
}

function shuffleWith<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const RELATION_LABELS: Record<RelationType, string> = {
  input: '环境输入',
  symbiosis: '共生',
  syntrophy: '互养',
  predation: '捕食',
  competition: '竞争',
};

function speciesPublic(id: string) {
  const species = SPECIES_BY_ID.get(id);
  if (!species) throw new Error(`Unknown species ${id}`);
  return {
    id: species.id,
    name: species.name,
    latin: species.latin,
    kind: species.kind,
    role: species.role,
  };
}

/**
 * Constraint hash excludes geometry, labels, bank order and all answer data.
 * It therefore proves that shuffling preserves the actual ecological CSP.
 */
export function constraintHash(level: EcologyLevel) {
  const canonicalNode = new Map(level.slots.map((slot) => [slot.slotId, slot.canonicalSpeciesId]));
  return sha256({
    rules: RULES_VERSION,
    nodes: level.slots
      .map((slot) => slot.canonicalSpeciesId)
      .sort(),
    edges: level.edges.map((edge) => ({
      source: canonicalNode.get(edge.source) ?? edge.source,
      target: canonicalNode.get(edge.target) ?? edge.target,
      relation: edge.relation,
      resource: edge.resource ?? null,
    })),
  });
}

const BLANK_LABELS = ['空位 A', '空位 B', '空位 C', '空位 D', '空位 E', '空位 F', '空位 G', '空位 H'];

/**
 * Generate from a known viable authoring template, independently rename the
 * blank slots, and then solve the renamed CSP from scratch. The original
 * canonical assignment is never sufficient by itself.
 */
export function generatePuzzle(level: EcologyLevel, seed: string): { puzzle: PublicPuzzle; proof: SolvabilityProof; level: EcologyLevel } {
  const random = mulberry32(hashSeed(seed));
  const lockedSlots = level.slots.filter((slot) => slot.locked);
  const originalBlankSlots = level.slots.filter((slot) => !slot.locked);
  const publicIds = shuffleWith(
    Array.from({ length: originalBlankSlots.length }, (_, index) => `slot-${index + 1}-${sha256(`${level.id}:${seed}:${index}`).slice(0, 8)}`),
    random,
  );

  const remap: Record<string, string> = {};
  lockedSlots.forEach((slot) => {
    remap[slot.slotId] = slot.slotId;
  });
  originalBlankSlots.forEach((slot, index) => {
    remap[slot.slotId] = publicIds[index];
  });

  const shuffledSlots = level.slots.map((slot) => ({
    ...slot,
    slotId: remap[slot.slotId],
    label: slot.locked ? slot.label : BLANK_LABELS[originalBlankSlots.findIndex((item) => item.slotId === slot.slotId)],
  }));

  const shuffledEdges = level.edges.map((edge, index) => ({
    ...edge,
    id: `edge-${index + 1}`,
    source: remap[edge.source],
    target: remap[edge.target],
  }));

  const shuffledLevel: EcologyLevel = {
    ...level,
    slots: shuffledSlots,
    edges: shuffledEdges,
  };

  const canonicalWitness: Record<string, string> = {};
  shuffledLevel.slots.forEach((slot) => {
    canonicalWitness[slot.slotId] = slot.canonicalSpeciesId;
  });

  // Independent proof: run the same backtracking solver used to judge players.
  const solverResult = solve(shuffledLevel, SOLUTION_LIMIT);
  if (solverResult.count === 0) {
    throw new Error(`Generated puzzle ${level.id} from seed ${seed} has no solution`);
  }
  if (gradeAssignment(shuffledLevel, canonicalWitness).verdict !== 'accepted') {
    throw new Error(`Generated puzzle ${level.id} rejected its constructive witness`);
  }

  const generatedConstraintHash = constraintHash(shuffledLevel);
  const proof: SolvabilityProof = {
    levelId: level.id,
    generatedFromSeed: seed,
    shuffled: true,
    witness: solverResult.solutions[0],
    witnessVerdict: 'accepted',
    solverSolutionCount: solverResult.count >= SOLUTION_LIMIT ? 'many' : solverResult.count,
    solverSolutionLimit: SOLUTION_LIMIT,
    invariantHashes: {
      levelConstraintHash: constraintHash(level),
      shuffledConstraintHash: generatedConstraintHash,
    },
    soundnessChecks: [
      'slot-renaming is a bijective permutation and does not change edge endpoints',
      'independent backtracking solver found at least one complete assignment',
      'constructive witness was replayed through the production grader',
      'all locked nodes were fixed before player tokens were offered',
    ],
    note: 'The public API exposes only this proof summary and commitment, never the witness.',
  };

  const bankIds = shuffleWith(
    [
      ...originalBlankSlots.map((slot) => slot.canonicalSpeciesId),
      ...level.distractors,
    ],
    random,
  );

  const puzzle: PublicPuzzle = {
    puzzleId: sha256({ levelId: level.id, seed, kind: 'ecology-puzzle' }),
    levelId: level.id,
    name: level.name,
    summary: level.summary,
    source: level.source,
    blankCount: originalBlankSlots.length,
    solutionPolicy: 'all-satisfying-ecological-assignments-pass',
    slots: shuffledSlots.map((slot) => ({
      slotId: slot.slotId,
      label: slot.label,
      locked: slot.locked,
      lockedSpeciesId: slot.locked ? slot.canonicalSpeciesId : undefined,
      x: slot.x,
      y: slot.y,
    })),
    edges: shuffledEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      description: edge.description,
    })),
    bank: bankIds.map(speciesPublic),
    lockedSpecies: level.slots.filter((slot) => slot.locked).map((slot) => speciesPublic(slot.canonicalSpeciesId)),
  };

  return { puzzle, proof, level: shuffledLevel };
}

interface EdgeCheck {
  violations: EdgeViolation[];
  supportByTarget: Map<string, Set<string>>;
  availableByTarget: Map<string, Set<string>>;
}

function addSet(map: Map<string, Set<string>>, key: string, value: string) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(value);
}

function checkEdges(level: EcologyLevel, assignment: Record<string, string | null>): EdgeCheck {
  const violations: EdgeViolation[] = [];
  const supportByTarget = new Map<string, Set<string>>();
  const availableByTarget = new Map<string, Set<string>>();
  const knownSlots = new Set(level.slots.map((slot) => slot.slotId));

  for (const edge of level.edges) {
    const sourceId = assignment[edge.source];
    const targetId = assignment[edge.target];
    const fail = (reason: string) => {
      violations.push({
        edgeId: edge.id,
        relation: edge.relation,
        source: edge.source,
        target: edge.target,
        reason,
      });
    };

    if (!knownSlots.has(edge.source) || !knownSlots.has(edge.target)) {
      fail('边引用了不存在的节点');
      continue;
    }
    if (!sourceId || !targetId) {
      // Partial solver assignments deliberately ignore still-empty edges.
      // Complete submissions reject blanks before simulation via shape checks.
      continue;
    }

    const source = SPECIES_BY_ID.get(sourceId);
    const target = SPECIES_BY_ID.get(targetId);
    if (!source || !target) {
      fail('提交包含未知物种');
      continue;
    }

    let legal = true;
    const reject = (detail: string) => {
      legal = false;
      fail(detail);
    };

    switch (edge.relation) {
      case 'input': {
        if (source.strategy !== 'abiotic') reject('环境输入边必须来自非生物环境');
        if (!edge.resource || !source.produces?.includes(edge.resource)) reject('环境源不能提供声明的底物');
        if (target.strategy === 'abiotic') reject('非生物节点不能作为营养输入的目标');
        if (target.strategy !== 'photoautotroph' && target.strategy !== 'chemolithoautotroph' && target.strategy !== 'heterotroph') {
          reject('目标节点不能利用该输入');
        }
        if (![...(target.usesExternal ?? []), ...(target.consumes ?? [])].includes(edge.resource)) {
          reject('目标物种不使用该资源');
        }
        break;
      }
      case 'symbiosis': {
        const shared = target.consumes?.filter((resource) => source.produces?.includes(resource)) ?? [];
        const tagsMatch = Boolean(source.symbiosisTag && target.seeksSymbiosis === source.symbiosisTag);
        if (shared.length === 0 && !tagsMatch) {
          reject('共生双方既没有匹配的交换资源，也没有匹配的宿主—共生体识别标记');
        }
        if (source.id === target.id) reject('物种不能与自身形成共生');
        break;
      }
      case 'syntrophy': {
        if (!edge.resource || !source.produces?.includes(edge.resource)) reject('上游物种不产生声明的代谢物');
        if (!edge.resource || !target.consumes?.includes(edge.resource)) reject('下游物种不消费声明的代谢物');
        if (source.strategy === 'abiotic') reject('互养边应连接生物代谢伙伴，环境底物请使用输入关系');
        break;
      }
      case 'predation': {
        const eats = target.preyTags?.some((tag) => source.tags?.includes(tag));
        if (!eats) reject('猎物功能类型不在捕食者食性内');
        break;
      }
      case 'competition': {
        if (!source.niche || source.niche !== target.niche) reject('两个物种没有共享的限制性生态位');
        if (source.id === target.id) reject('同一物种不能与自己竞争');
        break;
      }
      default:
        reject(`未知关系类型：${String(edge.relation)}`);
    }

    if (legal) {
      addSet(supportByTarget, edge.target, edge.source);
      if (edge.relation === 'input') {
        if (edge.resource) addSet(availableByTarget, edge.target, edge.resource);
      }
      if (edge.relation === 'syntrophy' && edge.resource) {
        addSet(availableByTarget, edge.target, edge.resource);
      }
      if (edge.relation === 'symbiosis') {
        source.produces?.forEach((resource) => {
          if (target.consumes?.includes(resource)) addSet(availableByTarget, edge.target, resource);
        });
      }
    }
  }

  return { violations, supportByTarget, availableByTarget };
}

/**
 * Least fixed point: environments are initially alive; a biological node only
 * becomes alive when at least one legal trophic/symbiotic source is already
 * alive and all declared limiting resources are available. This intentionally
 * rejects a pair that is waiting for each other with no external carbon path.
 */
function simulate(
  level: EcologyLevel,
  assignment: Record<string, string | null>,
  edgeCheck: EdgeCheck,
): { active: Set<string>; failures: NodeFailure[] } {
  const active = new Set<string>();
  const slotSpecies = new Map(level.slots.map((slot) => [slot.slotId, assignment[slot.slotId]]));

  for (const slot of level.slots) {
    const speciesId = slotSpecies.get(slot.slotId);
    const species = speciesId ? SPECIES_BY_ID.get(speciesId) : undefined;
    if (species?.strategy === 'abiotic') active.add(slot.slotId);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const slot of level.slots) {
      if (active.has(slot.slotId)) continue;
      const speciesId = slotSpecies.get(slot.slotId);
      const species = speciesId ? SPECIES_BY_ID.get(speciesId) : undefined;
      if (!species) continue;
      const available = edgeCheck.availableByTarget.get(slot.slotId) ?? new Set<string>();
      const supportSlots = [...(edgeCheck.supportByTarget.get(slot.slotId) ?? new Set<string>())];
      const hasActiveSupport = supportSlots.some((sourceSlot) => active.has(sourceSlot));
      const limitingResources = [...new Set([...(species.usesExternal ?? []), ...(species.consumes ?? [])])];
      const resourcesReady = limitingResources.every((resource) => available.has(resource));
      if (hasActiveSupport && resourcesReady) {
        active.add(slot.slotId);
        changed = true;
      }
    }
  }

  const inactive = level.slots.map((slot) => slot.slotId).filter((slotId) => !active.has(slotId));
  const failures: NodeFailure[] = [];
  const deadlockSlots = findDeadlockCycles(inactive, edgeCheck.supportByTarget, active);

  for (const slotId of inactive) {
    const speciesId = slotSpecies.get(slotId);
    const species = speciesId ? SPECIES_BY_ID.get(speciesId) : undefined;
    if (!species) continue;
    const incoming = edgeCheck.supportByTarget.get(slotId) ?? new Set<string>();
    const legalIncoming = [...incoming].filter((source) => assignment[source]);
    if (deadlockSlots.has(slotId)) {
      failures.push({
        slotId,
        speciesId: species.id,
        name: species.name,
        reason: 'deadlock-cycle',
        detail: '所有支持路径都在等待尚未激活的伙伴；闭环中没有外部碳源可启动',
        cycle: findExampleCycle(slotId, edgeCheck.supportByTarget, active),
      });
    } else if (legalIncoming.length === 0) {
      failures.push({
        slotId,
        speciesId: species.id,
        name: species.name,
        reason: 'no-carbon-source',
        detail: '没有合法的环境输入、互养、共生或捕食边提供可利用碳源',
      });
    } else {
      failures.push({
        slotId,
        speciesId: species.id,
        name: species.name,
        reason: 'upstream-collapse',
        detail: '上游物种已经饿死或处于死锁，碳流无法到达本节点',
      });
    }
  }

  return { active, failures: failures.sort((a, b) => a.slotId.localeCompare(b.slotId)) };
}

function findDeadlockCycles(inactive: string[], support: Map<string, Set<string>>, active: Set<string>) {
  const inactiveSet = new Set(inactive);
  const indexBySlot = new Map(inactive.map((slot, index) => [slot, index]));
  const indices = new Array<number>(inactive.length).fill(-1);
  const low = new Array<number>(inactive.length).fill(-1);
  const stack: number[] = [];
  const onStack = new Array<boolean>(inactive.length).fill(false);
  const cyclic = new Set<string>();
  let counter = 0;

  const neighbors = (slot: string) => [...(support.get(slot) ?? [])].filter((candidate) => inactiveSet.has(candidate) && !active.has(candidate));

  function visit(startIndex: number) {
    const work: Array<{ vertex: number; edgeIndex: number }> = [{ vertex: startIndex, edgeIndex: 0 }];
    indices[startIndex] = low[startIndex] = counter++;
    stack.push(startIndex);
    onStack[startIndex] = true;

    while (work.length) {
      const frame = work[work.length - 1];
      const vertexSlot = inactive[frame.vertex];
      const next = neighbors(vertexSlot);
      if (frame.edgeIndex < next.length) {
        const nextSlot = next[frame.edgeIndex++];
        const nextIndex = indexBySlot.get(nextSlot)!;
        if (indices[nextIndex] === -1) {
          indices[nextIndex] = low[nextIndex] = counter++;
          stack.push(nextIndex);
          onStack[nextIndex] = true;
          work.push({ vertex: nextIndex, edgeIndex: 0 });
        } else if (onStack[nextIndex]) {
          low[frame.vertex] = Math.min(low[frame.vertex], indices[nextIndex]);
        }
      } else {
        if (low[frame.vertex] === indices[frame.vertex]) {
          const component: number[] = [];
          let popped = -1;
          do {
            popped = stack.pop()!;
            onStack[popped] = false;
            component.push(popped);
          } while (popped !== frame.vertex);
          const hasInternalSupport = component.some((vertex) => neighbors(inactive[vertex]).some((candidate) => indexBySlot.get(candidate) !== undefined && component.includes(indexBySlot.get(candidate)!)));
          if (component.length > 1 && hasInternalSupport) component.forEach((vertex) => cyclic.add(inactive[vertex]));
        }
        work.pop();
        if (work.length) {
          const child = frame.vertex;
          const parent = work[work.length - 1].vertex;
          low[parent] = Math.min(low[parent], low[child]);
        }
      }
    }
  }

  for (let i = 0; i < inactive.length; i += 1) {
    if (indices[i] === -1) visit(i);
  }
  return cyclic;
}

function findExampleCycle(start: string, support: Map<string, Set<string>>, active: Set<string>): string[] {
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(slot: string): string[] | null {
    visited.add(slot);
    path.push(slot);
    const candidates = [...(support.get(slot) ?? [])].filter((item) => !active.has(item));
    for (const candidate of candidates) {
      if (candidate === start && path.length > 0) return [...path, start];
      if (!visited.has(candidate)) {
        const result = dfs(candidate);
        if (result) return result;
      }
    }
    path.pop();
    return null;
  }

  return dfs(start) ?? [start];
}

export interface AssignmentIssue {
  code: 'missing-slot' | 'unknown-slot' | 'locked-slot' | 'unknown-species' | 'duplicate-species' | 'wrong-biome';
  slotId?: string;
  speciesId?: string;
  reason: string;
}

export function validateAssignmentShape(level: EcologyLevel, submission: Submission): AssignmentIssue[] {
  const issues: AssignmentIssue[] = [];
  const assignment = submission.assignment ?? {};
  const blankSlots = level.slots.filter((slot) => !slot.locked);
  const seen = new Map<string, string>();

  for (const [slotId, speciesId] of Object.entries(assignment)) {
    const slot = level.slots.find((item) => item.slotId === slotId);
    if (!slot) {
      issues.push({ code: 'unknown-slot', slotId, speciesId, reason: '提交引用了不存在的空位' });
      continue;
    }
    if (slot.locked && speciesId !== slot.canonicalSpeciesId) {
      issues.push({ code: 'locked-slot', slotId, speciesId, reason: '锁定节点不能由客户端改写' });
      continue;
    }
    if (slot.locked) continue;
    if (typeof speciesId !== 'string') {
      issues.push({ code: 'unknown-species', slotId, speciesId: String(speciesId), reason: '物种 ID 必须是字符串' });
      continue;
    }
    const species = SPECIES_BY_ID.get(speciesId);
    if (!species) {
      issues.push({ code: 'unknown-species', slotId, speciesId, reason: '提交了服务端物种目录之外的物种' });
      continue;
    }
    if (seen.has(speciesId)) {
      issues.push({ code: 'duplicate-species', slotId, speciesId, reason: `物种“${species.name}”被重复放入 ${seen.get(speciesId)} 和 ${slotId}` });
    } else {
      seen.set(speciesId, slotId);
    }
    if (species.biome !== level.biome) {
      issues.push({ code: 'wrong-biome', slotId, speciesId, reason: `物种“${species.name}”不属于本关生态系统` });
    }
  }

  for (const slot of blankSlots) {
    if (!assignment[slot.slotId]) {
      issues.push({ code: 'missing-slot', slotId: slot.slotId, reason: `还有空位未填写：${slot.label}` });
    }
  }
  return issues.sort((a, b) => (a.slotId ?? '').localeCompare(b.slotId ?? ''));
}

export function gradeAssignment(level: EcologyLevel, rawAssignment: Record<string, string>): Omit<GradeResult, 'score' | 'hintPenalty'> {
  const shapeIssues = validateAssignmentShape(level, { puzzleId: '', assignment: rawAssignment });
  const assignment: Record<string, string | null> = {};
  for (const slot of level.slots) {
    assignment[slot.slotId] = slot.locked ? slot.canonicalSpeciesId : (rawAssignment[slot.slotId] ?? null);
  }

  const edgeCheck = checkEdges(level, assignment);
  const { active, failures } = shapeIssues.length
    ? { active: new Set<string>(), failures: [] as NodeFailure[] }
    : simulate(level, assignment, edgeCheck);

  const invalidRelations = shapeIssues.map((issue) => ({
    edgeId: issue.slotId ?? 'submission',
    relation: 'input' as const,
    source: issue.slotId ?? 'submission',
    target: issue.speciesId ?? 'unknown',
    reason: issue.reason,
  }));
  const allInvalidRelations = [...invalidRelations, ...edgeCheck.violations].sort((a, b) =>
    `${a.edgeId}:${a.target}`.localeCompare(`${b.edgeId}:${b.target}`),
  );

  // Report how many assignments satisfy the whole level; the verdict itself is
  // independently derived from this exact assignment, never from the count.
  const solverResult = shapeIssues.length ? { count: 0 as const } : solve(level, SOLUTION_LIMIT);
  const accepted = shapeIssues.length === 0 && edgeCheck.violations.length === 0 && failures.length === 0;
  const decisionInput = {
    rules: RULES_VERSION,
    levelId: level.id,
    assignment: level.slots.map((slot) => [slot.slotId, assignment[slot.slotId]]).sort(([a], [b]) => a.localeCompare(b)),
    accepted,
  };

  return {
    verdict: accepted ? 'accepted' : 'rejected',
    baseScore: accepted ? FULL_MARKS : 0,
    invalidRelations: allInvalidRelations,
    nodeFailures: failures,
    activeSlots: [...active].sort(),
    solver: {
      solutionCount: solverResult.count >= SOLUTION_LIMIT ? 'many' : solverResult.count,
      solutionCountLimit: SOLUTION_LIMIT,
      checkedBy: 'independent-server-backtracking-solver',
    },
    rulesVersion: RULES_VERSION,
    decisionHash: sha256(decisionInput),
    message: accepted
      ? '通过：所有声明关系合法，并且每个物种都能从已激活伙伴获得碳源。'
      : '网络坍塌：请根据非法关系、缺碳节点或死锁闭环调整放置。',
  };
}

interface SolveResult {
  count: number;
  solutions: Array<Record<string, string>>;
  explored: number;
}

/**
 * Deterministic CSP solver. It does not trust the authored witness: each
 * candidate is replayed through the complete ecological validator. Search is
 * bounded, and blank ordering chooses the slot with fewest legal candidates.
 */
export function solve(level: EcologyLevel, limit = 2, fixedAssignment?: Record<string, string | null>): SolveResult {
  const blankSlots = level.slots.filter((slot) => !slot.locked);
  const candidateIds = Array.from(new Set([
    ...blankSlots.map((slot) => slot.canonicalSpeciesId),
    ...level.slots.map((slot) => slot.canonicalSpeciesId),
  ])).filter((id) => {
    const species = SPECIES_BY_ID.get(id);
    return species && species.biome === level.biome;
  }).sort();

  const usedLocked = new Set(level.slots.filter((slot) => slot.locked).map((slot) => slot.canonicalSpeciesId));
  const solutions: Array<Record<string, string>> = [];
  let explored = 0;
  const maxExplored = 200_000;

  function isComplete(assignment: Record<string, string | null>) {
    return blankSlots.every((slot) => assignment[slot.slotId]);
  }

  function legalPartial(assignment: Record<string, string | null>): boolean {
    const result = checkEdges(level, assignment);
    if (result.violations.length) return false;
    // A complete assignment must also survive least-fixed-point activation.
    if (isComplete(assignment)) return simulate(level, assignment, result).failures.length === 0;
    return true;
  }

  function search(current: Record<string, string | null>, used: Set<string>): void {
    if (solutions.length >= limit || explored >= maxExplored) return;
    explored += 1;

    let nextSlot: (typeof blankSlots)[number] | undefined;
    let nextCandidates: string[] = [];
    for (const slot of blankSlots) {
      if (current[slot.slotId]) continue;
      const candidates = candidateIds.filter((id) => !used.has(id) && !usedLocked.has(id));
      const legal = candidates.filter((id) => {
        const trial = { ...current, [slot.slotId]: id };
        return legalPartial(trial);
      });
      if (!nextSlot || legal.length < nextCandidates.length) {
        nextSlot = slot;
        nextCandidates = legal;
      }
      if (legal.length === 0) return;
    }

    if (!nextSlot) {
      if (legalPartial(current) && isComplete(current)) {
        const solution: Record<string, string> = {};
        for (const slot of blankSlots) solution[slot.slotId] = current[slot.slotId]!;
        if (!solutions.some((existing) => stableStringify(existing) === stableStringify(solution))) {
          solutions.push(solution);
        }
      }
      return;
    }

    for (const speciesId of nextCandidates) {
      current[nextSlot.slotId] = speciesId;
      used.add(speciesId);
      search(current, used);
      used.delete(speciesId);
      current[nextSlot.slotId] = null;
      if (solutions.length >= limit || explored >= maxExplored) return;
    }
  }

  const initial: Record<string, string | null> = {};
  for (const slot of level.slots) initial[slot.slotId] = slot.locked ? slot.canonicalSpeciesId : null;
  const fixedUsed = new Set(usedLocked);
  if (fixedAssignment) {
    for (const slot of blankSlots) {
      const speciesId = fixedAssignment[slot.slotId];
      if (speciesId) {
        initial[slot.slotId] = speciesId;
        fixedUsed.add(speciesId);
      }
    }
  }
  search(initial, fixedUsed);
  return { count: solutions.length, solutions, explored };
}

const HINT_PENALTIES = { 1: 5, 2: 10, 3: 20 } as const;
const HINT_DELAYS_MS = { 1: 120_000, 2: 180_000, 3: 240_000 } as const;

export function hintPolicy(elapsedMs: number, requestedTier: 1 | 2 | 3) {
  if (elapsedMs < HINT_DELAYS_MS[requestedTier]) {
    return { allowed: false as const, retryAfterMs: HINT_DELAYS_MS[requestedTier] - elapsedMs };
  }
  return { allowed: true as const, penalty: HINT_PENALTIES[requestedTier] };
}

function canonicalSlot(level: EcologyLevel, publicSlotId: string, proof: SolvabilityProof) {
  const speciesId = proof.witness[publicSlotId];
  return {
    slot: level.slots.find((item) => item.canonicalSpeciesId === speciesId),
    species: speciesId ? SPECIES_BY_ID.get(speciesId) : undefined,
  };
}

export function buildHint(session: PuzzleSession, slotId: string, tier: 1 | 2 | 3, now = Date.now()) {
  const elapsed = now - session.createdAt;
  const policy = hintPolicy(elapsed, tier);
  if (!policy.allowed) return policy;

  const slot = session.level.slots.find((item) => item.slotId === slotId);
  const { species } = canonicalSlot(session.level, slotId, session.proof);
  if (!slot || !species || slot.locked) {
    return { allowed: false as const, retryAfterMs: 0, reason: 'invalid-slot' as const };
  }

  const prior = session.usedHints[slotId] ?? new Set<1 | 2 | 3>();
  const newLevels = ([1, 2, 3] as const).filter((level) => level <= tier && !prior.has(level));
  const penalty = newLevels.reduce((sum, level) => sum + HINT_PENALTIES[level], 0);
  session.usedHints[slotId] = new Set([...prior, ...newLevels]);
  session.hintPenalty += penalty;

  const relationSummary = session.level.edges
    .filter((edge) => edge.target === slotId || edge.source === slotId)
    .map((edge) => {
      const direction = edge.target === slotId ? '需要接收' : '向外供给/作用';
      return `${direction}「${RELATION_LABELS[edge.relation]}」`;
    });

  let message = '';
  if (tier === 1) message = `功能角色提示：这里应放入${species.role}。`;
  if (tier === 2) message = `相邻关系提示：本节点涉及：${relationSummary.join('、')}。先寻找能闭合这些资源方向的物种。`;
  if (tier === 3) {
    const candidates = candidateCountForSlot(session.level, slot);
    message = `收窄范围：服务端目录中只剩 ${candidates === 1 ? '极少数' : `约 ${candidates} 类`} 功能候选；仍需你自己拖入并提交。`;
  }

  return {
    allowed: true as const,
    penalty,
    totalPenalty: session.hintPenalty,
    tier,
    message,
  };
}

function candidateCountForSlot(level: EcologyLevel, targetSlot: (typeof level.slots)[number]) {
  const assignment: Record<string, string | null> = {};
  for (const slot of level.slots) assignment[slot.slotId] = slot.locked ? slot.canonicalSpeciesId : null;
  let count = 0;
  for (const species of level.species) {
    assignment[targetSlot.slotId] = species.id;
    const result = checkEdges(level, assignment);
    if (result.violations.length === 0) count += 1;
    assignment[targetSlot.slotId] = null;
  }
  return count;
}

export function gradeSession(session: PuzzleSession, assignment: Submission['assignment']): GradeResult {
  const result = gradeAssignment(session.level, assignment);
  const hintPenalty = result.verdict === 'accepted' ? session.hintPenalty : 0;
  return {
    ...result,
    hintPenalty,
    score: Math.max(0, result.baseScore - hintPenalty),
  };
}

export function makeProofArtifact(level: EcologyLevel, seed: string): SolvabilityProof {
  return generatePuzzle(level, seed).proof;
}

export function registerFixtureSpecies(items: Species[]) {
  for (const item of items) SPECIES_BY_ID.set(item.id, item);
}
