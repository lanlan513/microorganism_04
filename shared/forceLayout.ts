export interface LayoutNode {
  id: string;
  radius: number;
  /** Optional deterministic layer slot, useful for abiotic anchors and placeholders. */
  layer?: number;
  fixed?: boolean;
  x?: number;
  y?: number;
}

export interface LayoutLink {
  source: string;
  target: string;
  strength?: number;
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  iterations: number;
  elapsedMs: number;
  converged: boolean;
  /** No pair of node disks overlaps after collision separation. */
  collisionFree: boolean;
  width: number;
  height: number;
}

export interface ForceLayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
  linkDistance?: number;
  nodePadding?: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Deterministic force layout with O(iterations * (V^2 + E)).
 * The benchmark uses this exact implementation, so the reported number is not
 * an animation frame estimate.
 */
export function layoutNetwork(nodes: LayoutNode[], links: LayoutLink[], options: ForceLayoutOptions = {}): LayoutResult {
  const start = now();
  const width = options.width ?? 1200;
  const height = options.height ?? 800;
  const maxIterations = options.iterations ?? 70;
  const baseLinkDistance = options.linkDistance ?? 92;
  const padding = options.nodePadding ?? 8;
  const centerX = width / 2;
  const centerY = height / 2;

  const points = nodes.map((node, index) => {
    if (node.fixed && node.x !== undefined && node.y !== undefined) {
      return { id: node.id, x: node.x, y: node.y, radius: node.radius, vx: 0, vy: 0, fixed: true };
    }
    const layerCount = Math.max(1, new Set(nodes.map((item) => item.layer ?? 0)).size);
    const layer = node.layer ?? 0;
    const layerRadius = 70 + layer * Math.min(130, Math.min(width, height) / (layerCount + 2));
    const angle = index * GOLDEN_ANGLE;
    return {
      id: node.id,
      x: centerX + Math.cos(angle) * layerRadius,
      y: centerY + Math.sin(angle) * layerRadius,
      radius: node.radius,
      vx: 0,
      vy: 0,
      fixed: false,
    };
  });

  const byId = new Map(points.map((point, index) => [point.id, index]));
  const edges = links
    .map((link) => ({ source: byId.get(link.source), target: byId.get(link.target), strength: link.strength ?? 1 }))
    .filter((edge): edge is { source: number; target: number; strength: number } => edge.source !== undefined && edge.target !== undefined);

  let iteration = 0;

  for (iteration = 0; iteration < maxIterations; iteration += 1) {
    const vx = new Float64Array(points.length);
    const vy = new Float64Array(points.length);
    const cooling = 1 - iteration / maxIterations;
    const repulsion = 7600 * (0.35 + cooling);

    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 0.01) {
          dx = ((i & 1) === 0 ? 1 : -1) * 0.5;
          dy = ((j & 1) === 0 ? 0.5 : -0.5);
          distanceSquared = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(distanceSquared);
        const force = repulsion / distanceSquared;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        vx[i] += fx;
        vy[i] += fy;
        vx[j] -= fx;
        vy[j] -= fy;
      }
    }

    for (const edge of edges) {
      const a = points[edge.source];
      const b = points[edge.target];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const desired = baseLinkDistance + (a.radius + b.radius) / 2;
      const force = (distance - desired) * 0.055 * edge.strength;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      vx[edge.source] += fx;
      vy[edge.source] += fy;
      vx[edge.target] -= fx;
      vy[edge.target] -= fy;
    }

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      vx[i] += (centerX - point.x) * 0.006;
      vy[i] += (centerY - point.y) * 0.006;
    }

    let movement = 0;
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      if (point.fixed) continue;
      point.vx = (point.vx + vx[i]) * 0.72;
      point.vy = (point.vy + vy[i]) * 0.72;
      point.x += clamp(point.vx, -26, 26);
      point.y += clamp(point.vy, -26, 26);
      point.x = clamp(point.x, point.radius + padding, width - point.radius - padding);
      point.y = clamp(point.y, point.radius + padding, height - point.radius - padding);
      movement += Math.abs(point.vx) + Math.abs(point.vy);
    }

    // Pairwise collision relaxation keeps dense graphs readable before render.
    for (let pass = 0; pass < 30; pass += 1) {
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const a = points[i];
          const b = points[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
          const minimum = a.radius + b.radius + padding;
          if (distance >= minimum) continue;
          const push = (minimum - distance) / 2;
          const ux = dx / distance;
          const uy = dy / distance;
          if (!a.fixed) {
            a.x -= ux * push;
            a.y -= uy * push;
          }
          if (!b.fixed) {
            b.x += ux * push;
            b.y += uy * push;
          }
        }
      }
    }

    if (movement / points.length < 0.045 && iteration >= 18) {
      iteration += 1;
      break;
    }
  }

  // Final relaxation without another force tick: every disk has a hard radius.
  for (let pass = 0; pass < 80; pass += 1) {
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const minimum = a.radius + b.radius + padding;
        if (distance >= minimum) continue;
        const overlap = minimum - distance;
        const ux = dx / distance;
        const uy = dy / distance;
        const aWeight = a.fixed ? 0 : b.fixed ? 1 : 0.5;
        const bWeight = b.fixed ? 0 : a.fixed ? 1 : 0.5;
        a.x -= ux * overlap * aWeight;
        a.y -= uy * overlap * aWeight;
        b.x += ux * overlap * bWeight;
        b.y += uy * overlap * bWeight;
        a.x = clamp(a.x, a.radius + padding, width - a.radius - padding);
        a.y = clamp(a.y, a.radius + padding, height - a.radius - padding);
        b.x = clamp(b.x, b.radius + padding, width - b.radius - padding);
        b.y = clamp(b.y, b.radius + padding, height - b.radius - padding);
      }
    }
  }

  const elapsedMs = now() - start;
  let collisionFree = true;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minimum = a.radius + b.radius + padding;
      if (Math.sqrt(dx * dx + dy * dy) < minimum - 0.25) {
        collisionFree = false;
        break;
      }
    }
    if (!collisionFree) break;
  }

  return {
    positions: Object.fromEntries(points.map((point) => [point.id, { x: point.x, y: point.y }])),
    iterations: iteration,
    elapsedMs,
    converged: collisionFree,
    collisionFree,
    width,
    height,
  };
}

export function makeBenchmarkGraph(nodeCount = 100, edgeCount = 260): { nodes: LayoutNode[]; links: LayoutLink[] } {
  const nodes: LayoutNode[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: `n-${index}`,
    radius: 18 + (index % 7) * 2,
    layer: index % 5,
  }));
  const links: LayoutLink[] = [];
  for (let i = 1; i < nodeCount; i += 1) {
    links.push({ source: `n-${i}`, target: `n-${Math.floor(i * 0.45)}`, strength: 0.8 + (i % 3) * 0.1 });
  }
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  while (links.length < edgeCount) {
    const source = Math.floor(random() * nodeCount);
    const target = Math.floor(random() * nodeCount);
    if (source !== target) links.push({ source: `n-${source}`, target: `n-${target}`, strength: 0.7 });
  }
  return { nodes, links };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}
