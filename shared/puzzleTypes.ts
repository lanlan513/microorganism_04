export type RelationKind =
  | 'resource-supply'
  | 'symbiosis'
  | 'competition'
  | 'cross-feeding'
  | 'predation';

export type SpeciesKind = 'resource' | 'producer' | 'consumer' | 'decomposer' | 'host';

export interface PuzzleSpecies {
  id: string;
  name: string;
  scientificName?: string;
  kind: SpeciesKind;
  guild: string;
  description: string;
  /** Molecules or carbon forms this abiotic resource / organism can provide. */
  provides?: string[];
  /** Carbon, energy or nutrient forms that can support it. */
  requires?: string[];
  /** Matching tags make a symbiosis edge legal. */
  partnerTags?: string[];
  /** Traits that predators may select for. */
  traits?: string[];
  /** Traits of prey this predator can consume. */
  preyTags?: string[];
  /** Species competing for the same ecological niche. */
  niche?: string;
  /** Abiotic sources are the bootstrap set in the least-fixed-point proof. */
  bootstrap?: boolean;
}

export interface PuzzleSlot {
  id: string;
  label: string;
  accepts: string[];
  acceptsGuild: string;
  clue: string;
  /** Canonical witness assignment; never sent to browsers. */
  witnessSpeciesId: string;
}

export interface PuzzleEdgeTemplate {
  source: string;
  target: string;
  kind: RelationKind;
  label: string;
}

export interface PuzzleLevelTemplate {
  id: string;
  version: number;
  title: string;
  scene: string;
  intro: string;
  resources: PuzzleSpecies[];
  fixedSpecies: PuzzleSpecies[];
  speciesCatalog: PuzzleSpecies[];
  slots: PuzzleSlot[];
  edges: PuzzleEdgeTemplate[];
  knownMultipleSolutions: boolean;
}

export type Assignment = Record<string, string>;

export interface IllegalEdge {
  source: string;
  target: string;
  kind: RelationKind;
  label: string;
  reason: string;
}

export type CollapseReasonKind = 'starved' | 'deadlocked' | 'blocked';

export interface CollapsedNode {
  nodeId: string;
  name: string;
  reason: CollapseReasonKind;
  detail: string;
  cycleNodeIds?: string[];
}

export interface PuzzleEvaluation {
  solved: boolean;
  complete: boolean;
  filledSlots: number;
  totalSlots: number;
  activeNodeIds: string[];
  inactiveNodeIds: string[];
  illegalEdges: IllegalEdge[];
  collapsedNodes: CollapsedNode[];
  legalEdgeCount: number;
  edgeCount: number;
}

export interface SolvabilityProof {
  levelId: string;
  version: number;
  seed: number;
  generatedBy: 'constructive-witness-and-least-fixed-point';
  slotCount: number;
  candidateCount: number;
  shuffledCandidateOrder: string[];
  witnessFingerprint: string;
  witnessAssignment: Assignment;
  legalEdgeCount: number;
  activeNodeCount: number;
  totalNodeCount: number;
  solutionPolicy: 'every-legal-completed-network-passes';
  knownMultipleSolutions: boolean;
  shuffledAssignmentStillSolved: boolean;
}

export interface PublicProof {
  levelId: string;
  version: number;
  seed: number;
  generatedBy: string;
  slotCount: number;
  candidateCount: number;
  shuffledCandidateOrderHash: string;
  witnessFingerprint: string;
  legalEdgeCount: number;
  activeNodeCount: number;
  totalNodeCount: number;
  solutionPolicy: string;
  knownMultipleSolutions: boolean;
  shuffledAssignmentStillSolved: boolean;
}

export interface PublicPuzzleNode {
  id: string;
  name: string;
  scientificName?: string;
  kind: SpeciesKind;
  guild?: string;
  description: string;
  slotId?: string;
  acceptsGuild?: string;
  clue?: string;
  placeholder: boolean;
}

export interface PublicPuzzleLevel {
  id: string;
  version: number;
  title: string;
  scene: string;
  intro: string;
  nodes: PublicPuzzleNode[];
  edges: PuzzleEdgeTemplate[];
  slots: Array<Omit<PuzzleSlot, 'witnessSpeciesId' | 'accepts'>>;
  candidates: PuzzleSpecies[];
  proof: PublicProof;
}

export interface HintReceipt {
  levelId: string;
  version: number;
  tier: 1 | 2 | 3;
  penalty: number;
  nonce: string;
  sig: string;
}

export interface PuzzleSubmission {
  levelId: string;
  assignment: Assignment;
  hintReceipts?: HintReceipt[];
}

export interface PuzzleVerdict extends PuzzleEvaluation {
  status: 'solved' | 'collapsed' | 'incomplete' | 'illegal';
  score: number;
  hintPenalty: number;
  verdictHash: string;
  message: string;
}

export interface PuzzleHint {
  tier: 0 | 1 | 2 | 3;
  penalty: number;
  title: string;
  message: string;
  receipt?: HintReceipt;
}

export const RELATION_LABELS: Record<RelationKind, string> = {
  'resource-supply': '非生物供给',
  symbiosis: '共生',
  competition: '竞争',
  'cross-feeding': '互养',
  predation: '捕食',
};
