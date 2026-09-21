export type RelationType = 'input' | 'symbiosis' | 'syntrophy' | 'predation' | 'competition';

export type EnergyStrategy = 'abiotic' | 'photoautotroph' | 'chemolithoautotroph' | 'heterotroph';

export type SpeciesKind = 'environment' | 'microbe' | 'animal' | 'plant' | 'virus';

export interface Species {
  id: string;
  name: string;
  latin?: string;
  kind: SpeciesKind;
  role: string;
  biome: string;
  strategy: EnergyStrategy;
  /** External inputs which can independently activate a producer/environment node. */
  usesExternal?: string[];
  /** Metabolites this species makes available downstream. */
  produces?: string[];
  /** Metabolites required from another producer; a matching syntrophy edge supports it. */
  consumes?: string[];
  /** What a heterotroph can consume, e.g. chemolithoautotroph, fungus, crustacean. */
  preyTags?: string[];
  /** Taxonomic/functional tags used by the directed predation relation. */
  tags?: string[];
  /** Matching key/value pairs for non-trophic symbiont/host mutualisms. */
  symbiosisTag?: string;
  seeksSymbiosis?: string;
  /** Niche resources; equal values make a competition edge legal. */
  niche?: string;
}

export interface LevelSlot {
  slotId: string;
  canonicalSpeciesId: string;
  label: string;
  locked: boolean;
  x: number;
  y: number;
}

export interface LevelEdge {
  id: string;
  source: string;
  target: string;
  relation: RelationType;
  /** Source product -> target consumed resource, used for syntrophy. */
  resource?: string;
  description: string;
}

export interface EcologyLevel {
  id: string;
  name: string;
  biome: string;
  summary: string;
  source: string;
  species: Species[];
  slots: LevelSlot[];
  edges: LevelEdge[];
  /** Canonical species ids which are not offered as draggable tokens. */
  lockedSpeciesIds: string[];
  distractors: string[];
}

export interface PublicSlot {
  slotId: string;
  label: string;
  locked: boolean;
  lockedSpeciesId?: string;
  x: number;
  y: number;
}

export interface PublicEdge {
  id: string;
  source: string;
  target: string;
  relation: RelationType;
  description: string;
}

export interface PublicSpecies {
  id: string;
  name: string;
  latin?: string;
  kind: SpeciesKind;
  role: string;
}

export interface PublicPuzzle {
  puzzleId: string;
  levelId: string;
  name: string;
  summary: string;
  source: string;
  slots: PublicSlot[];
  edges: PublicEdge[];
  bank: PublicSpecies[];
  lockedSpecies: PublicSpecies[];
  blankCount: number;
  solutionPolicy: 'all-satisfying-ecological-assignments-pass';
}

export interface EdgeViolation {
  edgeId: string;
  relation: RelationType;
  source: string;
  target: string;
  reason: string;
}

export interface NodeFailure {
  slotId: string;
  speciesId: string;
  name: string;
  reason: 'no-carbon-source' | 'deadlock-cycle' | 'upstream-collapse';
  detail: string;
  cycle?: string[];
}

export type Verdict = 'accepted' | 'rejected';

export interface GradeResult {
  verdict: Verdict;
  score: number;
  baseScore: number;
  hintPenalty: number;
  invalidRelations: EdgeViolation[];
  nodeFailures: NodeFailure[];
  activeSlots: string[];
  solver: {
    solutionCount: number | 'many';
    solutionCountLimit: number;
    checkedBy: 'independent-server-backtracking-solver';
  };
  rulesVersion: string;
  /** Deterministic JSON hash of the assignment, puzzle and rule version. */
  decisionHash: string;
  message: string;
}

export interface Submission {
  puzzleId: string;
  assignment: Record<string, string>;
}

export interface SolvabilityProof {
  levelId: string;
  generatedFromSeed: string;
  shuffled: boolean;
  witness: Record<string, string>;
  witnessVerdict: 'accepted';
  solverSolutionCount: number | 'many';
  solverSolutionLimit: number;
  invariantHashes: {
    levelConstraintHash: string;
    shuffledConstraintHash: string;
  };
  soundnessChecks: string[];
  note: string;
}

export interface HintResult {
  tier: 1 | 2 | 3;
  penalty: number;
  message: string;
}
