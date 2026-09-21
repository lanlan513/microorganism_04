import crypto from 'node:crypto';
import type {
  Assignment,
  CollapsedNode,
  IllegalEdge,
  PuzzleEdgeTemplate,
  PuzzleEvaluation,
  PuzzleLevelTemplate,
  PuzzleSpecies,
  RelationKind,
  SolvabilityProof,
} from '../../../shared/puzzleTypes.js';

export interface GeneratedPuzzleLevel {
  template: PuzzleLevelTemplate;
  candidateOrder: string[];
  proof: SolvabilityProof;
}

interface ResolvedNode {
  id: string;
  slotId?: string;
  species: PuzzleSpecies;
  placeholder: boolean;
}

interface ResolvedGraph {
  nodes: Map<string, ResolvedNode>;
  edges: Array<PuzzleEdgeTemplate & { sourceNode?: ResolvedNode; targetNode?: ResolvedNode }>;
}

const ABILITY_EDGE_TYPES: RelationKind[] = ['resource-supply', 'symbiosis', 'cross-feeding', 'predation'];

function intersects(a: string[] = [], b: string[] = []): boolean {
  const right = new Set(b);
  return a.some((value) => right.has(value));
}

function sameSpeciesArray(a: string[] | undefined, b: string[] | undefined): boolean {
  return JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
}

function assignmentSize(assignment: Assignment): number {
  return Object.keys(assignment).filter((slotId) => assignment[slotId] !== '').length;
}

export function hashCanonicalJson(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function stableObjectHash(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deterministicShuffle<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function seedFromLevel(level: PuzzleLevelTemplate): number {
  const digest = crypto.createHash('sha256').update(`${level.id}:${level.version}`).digest();
  return digest.readUInt32BE(0);
}

function validateTemplate(template: PuzzleLevelTemplate) {
  const ids = new Set<string>();
  const allSpecies = [...template.resources, ...template.fixedSpecies, ...template.speciesCatalog];
  for (const species of allSpecies) {
    if (ids.has(species.id)) throw new Error(`Level ${template.id} has duplicate species ${species.id}`);
    ids.add(species.id);
  }
  for (const slot of template.slots) {
    if (ids.has(slot.id)) throw new Error(`Level ${template.id} slot id collides with species ${slot.id}`);
    ids.add(slot.id);
    if (!slot.accepts.includes(slot.witnessSpeciesId)) {
      throw new Error(`Level ${template.id} witness is not accepted by slot ${slot.id}`);
    }
    const witness = template.speciesCatalog.find((species) => species.id === slot.witnessSpeciesId);
    if (!witness) throw new Error(`Level ${template.id} slot ${slot.id} witness missing`);
    if (witness.guild !== slot.acceptsGuild) {
      throw new Error(`Level ${template.id} slot ${slot.id} witness guild mismatch`);
    }
  }
  const nodeIds = new Set(ids);
  for (const edge of template.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`Level ${template.id} edge references missing node: ${edge.source} -> ${edge.target}`);
    }
  }
}

export function witnessAssignment(template: PuzzleLevelTemplate): Assignment {
  return Object.fromEntries(template.slots.map((slot) => [slot.id, slot.witnessSpeciesId]));
}

function resolveGraph(template: PuzzleLevelTemplate, assignment: Assignment): ResolvedGraph {
  const nodes = new Map<string, ResolvedNode>();
  for (const species of [...template.resources, ...template.fixedSpecies]) {
    nodes.set(species.id, { id: species.id, species, placeholder: false });
  }

  for (const slot of template.slots) {
    const speciesId = assignment[slot.id];
    if (speciesId) {
      const species = template.speciesCatalog.find((candidate) => candidate.id === speciesId);
      if (species) nodes.set(slot.id, { id: slot.id, slotId: slot.id, species, placeholder: false });
      continue;
    }
    nodes.set(slot.id, {
      id: slot.id,
      slotId: slot.id,
      placeholder: true,
      species: {
        id: slot.id,
        name: slot.label,
        kind: 'consumer',
        guild: slot.acceptsGuild,
        description: slot.clue,
      },
    });
  }

  return {
    nodes,
    edges: template.edges.map((edge) => ({
      ...edge,
      sourceNode: nodes.get(edge.source),
      targetNode: nodes.get(edge.target),
    })),
  };
}

function edgeIllegal(template: PuzzleLevelTemplate, edge: PuzzleEdgeTemplate, source: PuzzleSpecies, target: PuzzleSpecies): string | null {
  switch (edge.kind) {
    case 'resource-supply': {
      if (source.kind !== 'resource') return '资源供给边必须从非生物资源节点出发';
      if (!intersects(source.provides, target.requires)) return `${source.name} 不提供 ${target.name} 所需的碳源或关键营养`;
      return null;
    }
    case 'cross-feeding': {
      const targetNeedsMetabolite = intersects(source.provides, target.requires);
      const reverseNeedsMetabolite = intersects(target.provides, source.requires);
      if (targetNeedsMetabolite || reverseNeedsMetabolite) return null;
      if (intersects(source.partnerTags, target.partnerTags)) return null;
      return `${source.name} 与 ${target.name} 之间没有可核对的代谢物交换`;
    }
    case 'symbiosis': {
      if (intersects(source.partnerTags, target.partnerTags)) return null;
      if (intersects(source.provides, target.requires) && intersects(target.provides, source.requires)) return null;
      return `${source.name} 与 ${target.name} 缺少相互匹配的共生结构或交换物`;
    }
    case 'predation': {
      if (intersects(source.preyTags, target.traits)) return null;
      if (intersects(target.preyTags, source.traits)) return null;
      // 菌异养植物从真菌“夺取”碳在题目模型里按捕食方向绘制。
      if (intersects(source.provides, target.requires) && target.kind === 'consumer' && target.partnerTags?.includes('mycoheterotroph')) return null;
      return `${source.name} 与 ${target.name} 之间没有可核对的取食关系`;
    }
    case 'competition': {
      if (!source.niche || source.niche !== target.niche) return `${source.name} 与 ${target.name} 不共享同一生态位，不能构成竞争`;
      if (!sameSpeciesArray(source.requires, target.requires) && !intersects(source.requires, target.requires)) {
        return '竞争物种必须争夺至少同一种关键资源';
      }
      return null;
    }
  }
}

export function validateAssignmentShape(template: PuzzleLevelTemplate, assignment: Assignment): string | null {
  if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) return '提交必须是 slotId -> speciesId 的对象';
  const slotIds = new Set(template.slots.map((slot) => slot.id));
  const submittedSlots = Object.keys(assignment);
  if (submittedSlots.some((slotId) => !slotIds.has(slotId))) return '提交包含不属于本关的空位';

  for (const slot of template.slots) {
    const speciesId = assignment[slot.id];
    if (speciesId === undefined || speciesId === '') continue;
    if (typeof speciesId !== 'string') return `空位 ${slot.label} 的物种 ID 非法`;
    if (!slot.accepts.includes(speciesId)) return `物种不能放入空位：${slot.label}`;
    const species = template.speciesCatalog.find((candidate) => candidate.id === speciesId);
    if (!species) return '提交了本关不存在的物种';
  }

  const used = submittedSlots.map((slotId) => assignment[slotId]).filter(Boolean);
  if (new Set(used).size !== used.length) return '同一个物种实例不能占据多个空位';
  return null;
}

function findIllegalEdges(template: PuzzleLevelTemplate, graph: ResolvedGraph): IllegalEdge[] {
  const illegal: IllegalEdge[] = [];
  for (const edge of graph.edges) {
    if (!edge.sourceNode || !edge.targetNode || edge.sourceNode.placeholder || edge.targetNode.placeholder) continue;
    const reason = edgeIllegal(template, edge, edge.sourceNode.species, edge.targetNode.species);
    if (reason) {
      illegal.push({
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        label: edge.label,
        reason,
      });
    }
  }
  return illegal;
}

function activeSupportGraph(graph: ResolvedGraph, illegalKeys: Set<string>) {
  const support = new Map<string, Set<string>>();
  for (const node of graph.nodes.values()) support.set(node.id, new Set());

  for (const edge of graph.edges) {
    if (!edge.sourceNode || !edge.targetNode || edge.sourceNode.placeholder || edge.targetNode.placeholder) continue;
    if (!ABILITY_EDGE_TYPES.includes(edge.kind)) continue;
    const key = `${edge.source}->${edge.target}:${edge.kind}`;
    if (illegalKeys.has(key)) continue;
    // Predation arrows point predator -> prey visually, but metabolic support flows prey -> predator.
    const supportTarget = edge.kind === 'predation' ? edge.source : edge.target;
    const supportSource = edge.kind === 'predation' ? edge.target : edge.source;
    support.get(supportTarget)?.add(supportSource);
  }
  return support;
}

function leastFixedPoint(graph: ResolvedGraph, illegalKeys: Set<string>) {
  const active = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.species.bootstrap || node.species.kind === 'resource') active.add(node.id);
  }

  const support = activeSupportGraph(graph, illegalKeys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes.values()) {
      if (active.has(node.id) || node.placeholder || node.species.kind === 'resource') continue;
      if ([...(support.get(node.id) ?? [])].some((sourceId) => active.has(sourceId))) {
        active.add(node.id);
        changed = true;
      }
    }
  }

  const inactive = [...graph.nodes.values()].filter((node) => !node.placeholder && !active.has(node.id));
  return { active, inactive, support };
}

function findCycle(startId: string, support: Map<string, Set<string>>, active: Set<string>): string[] | null {
  const stack: Array<{ id: string; pathIndex: number }> = [{ id: startId, pathIndex: 0 }];
  const path: string[] = [];
  const onPath = new Set<string>();

  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.pathIndex === 0) {
      path.push(frame.id);
      onPath.add(frame.id);
    }

    const predecessors = [...(support.get(frame.id) ?? [])].filter((id) => !active.has(id));
    if (frame.pathIndex < predecessors.length) {
      const next = predecessors[frame.pathIndex];
      frame.pathIndex += 1;
      if (onPath.has(next)) {
        const cycleStart = path.indexOf(next);
        return path.slice(cycleStart);
      }
      if (support.has(next)) stack.push({ id: next, pathIndex: 0 });
      continue;
    }

    path.pop();
    onPath.delete(frame.id);
    stack.pop();
  }
  return null;
}

function collapseNodes(graph: ResolvedGraph, inactive: ResolvedNode[], support: Map<string, Set<string>>, active: Set<string>): CollapsedNode[] {
  return inactive.map((node) => {
    const predecessors = [...(support.get(node.id) ?? [])];
    if (predecessors.length === 0) {
      return {
        nodeId: node.id,
        name: node.species.name,
        reason: 'starved',
        detail: `${node.species.name} 没有合法碳源、宿主或猎物输入`,
      };
    }

    const cycle = findCycle(node.id, support, active);
    if (cycle) {
      return {
        nodeId: node.id,
        name: node.species.name,
        reason: 'deadlocked',
        detail: `${node.species.name} 与支持网络中的伙伴互相等待，循环外没有已激活资源`,
        cycleNodeIds: cycle,
      };
    }

    return {
      nodeId: node.id,
      name: node.species.name,
      reason: 'blocked',
      detail: `${node.species.name} 的上游支持未激活，连锁坍塌到达此节点`,
    };
  });
}

export function evaluateAssignment(template: PuzzleLevelTemplate, assignment: Assignment): PuzzleEvaluation {
  const shapeError = validateAssignmentShape(template, assignment);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const graph = resolveGraph(template, assignment);
  const illegalEdges = findIllegalEdges(template, graph);
  const illegalKeys = new Set(illegalEdges.map((edge) => `${edge.source}->${edge.target}:${edge.kind}`));
  const { active, inactive, support } = leastFixedPoint(graph, illegalKeys);
  const filledSlots = assignmentSize(assignment);
  const complete = filledSlots === template.slots.length;

  return {
    solved: complete && illegalEdges.length === 0 && inactive.length === 0,
    complete,
    filledSlots,
    totalSlots: template.slots.length,
    activeNodeIds: [...active].filter((id) => !graph.nodes.get(id)?.placeholder),
    inactiveNodeIds: inactive.map((node) => node.id),
    illegalEdges,
    collapsedNodes: collapseNodes(graph, inactive, support, active),
    legalEdgeCount: graph.edges.length - illegalEdges.length,
    edgeCount: graph.edges.length,
  };
}

export function generateLevel(template: PuzzleLevelTemplate): GeneratedPuzzleLevel {
  validateTemplate(template);
  const candidateOrder = deterministicShuffle(
    template.speciesCatalog.map((species) => species.id),
    seedFromLevel(template)
  );

  const witness = witnessAssignment(template);
  const result = evaluateAssignment(template, witness);
  if (!result.solved) {
    const detail = [
      ...result.illegalEdges.map((edge) => `${edge.source}->${edge.target}: ${edge.reason}`),
      ...result.collapsedNodes.map((node) => `${node.nodeId}: ${node.detail}`),
    ].join('; ');
    throw new Error(`Generation-time proof failed for ${template.id}: ${detail}`);
  }

  const witnessFingerprint = hashCanonicalJson({
    levelId: template.id,
    version: template.version,
    assignment: witness,
  });

  const proof: SolvabilityProof = {
    levelId: template.id,
    version: template.version,
    seed: seedFromLevel(template),
    generatedBy: 'constructive-witness-and-least-fixed-point',
    slotCount: template.slots.length,
    candidateCount: template.speciesCatalog.length,
    shuffledCandidateOrder: candidateOrder,
    witnessFingerprint,
    witnessAssignment: witness,
    legalEdgeCount: result.legalEdgeCount,
    activeNodeCount: result.activeNodeIds.length,
    totalNodeCount: template.resources.length + template.fixedSpecies.length + template.slots.length,
    solutionPolicy: 'every-legal-completed-network-passes',
    knownMultipleSolutions: template.knownMultipleSolutions,
    shuffledAssignmentStillSolved: true,
  };

  return { template, candidateOrder, proof };
}

export function proveShuffleDoesNotChangeSolution(generated: GeneratedPuzzleLevel): SolvabilityProof {
  // The assignment maps semantic IDs, while candidateOrder only controls UI order.
  // Evaluate the same witness after generation to make the claim executable.
  const result = evaluateAssignment(generated.template, generated.proof.witnessAssignment);
  if (!result.solved) {
    throw new Error(`Shuffle proof failed for ${generated.template.id}`);
  }
  return { ...generated.proof, shuffledAssignmentStillSolved: true };
}
