export interface LayoutNode {
  id: string;
  x?: number;
  y?: number;
  radius?: number;
  fixed?: boolean;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  iterations: number;
  elapsedMs: number;
  converged: boolean;
  maxDisplacement: number;
  overlapCount: number;
  width: number;
  height: number;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
  radius?: number;
  showLabels?: boolean;
}

/**
 * Deterministic seeded force placement. Edges use springs, non-neighbours get
 * short-range repulsion, and a final collision pass guarantees readable gaps.
 * The same graph and seed always yields the same coordinates.
 */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): LayoutResult {
  const start = now();
  const width = options.width ?? 980;
  const height = options.height ?? 620;
  const iterations = options.iterations ?? 42;
  const defaultRadius = options.radius ?? (nodes.length > 60 ? 13 : 28);
  const cx = width / 2;
  const cy = height / 2;
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number; radius: number; fixed: boolean }>();

  nodes.forEach((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    const ring = Math.min(width, height) * 0.32;
    positions.set(node.id, {
      x: node.x ?? cx + Math.cos(angle) * ring,
      y: node.y ?? cy + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      radius: node.radius ?? defaultRadius,
      fixed: Boolean(node.fixed || (node.x !== undefined && node.y !== undefined)),
    });
  });

  const idealLength = nodes.length > 60 ? Math.max(38, Math.min(width, height) / Math.sqrt(nodes.length) * 1.25) : 128;
  let maxDisplacement = 0;
  let completedIteration = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    completedIteration = iteration + 1;
    maxDisplacement = 0;
    const cooling = 1 - iteration / iterations;
    const list = [...positions.values()];

    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minimum = a.radius + b.radius + (nodes.length > 60 ? 5 : 16);
        if (distance < minimum) {
          const force = (minimum - distance) * 0.08 * cooling;
          const ux = dx / distance;
          const uy = dy / distance;
          a.vx -= ux * force;
          a.vy -= uy * force;
          b.vx += ux * force;
          b.vy += uy * force;
        } else if (distance < idealLength * 1.8) {
          const force = 120 / (distance * distance) * cooling;
          const ux = dx / distance;
          const uy = dy / distance;
          a.vx -= ux * force;
          a.vy -= uy * force;
          b.vx += ux * force;
          b.vy += uy * force;
        }
      }
    }

    for (const edge of edges) {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (distance - idealLength) * 0.025 * cooling;
      const ux = dx / distance;
      const uy = dy / distance;
      a.vx += ux * force;
      a.vy += uy * force;
      b.vx -= ux * force;
      b.vy -= uy * force;
    }

    for (const point of positions.values()) {
      point.vx += (cx - point.x) * 0.002 * cooling;
      point.vy += (cy - point.y) * 0.002 * cooling;
      if (!point.fixed) {
        point.x += Math.max(-18, Math.min(18, point.vx));
        point.y += Math.max(-18, Math.min(18, point.vy));
        point.x = Math.max(point.radius + 4, Math.min(width - point.radius - 4, point.x));
        point.y = Math.max(point.radius + 4, Math.min(height - point.radius - 4, point.y));
        maxDisplacement = Math.max(maxDisplacement, Math.hypot(point.vx, point.vy));
      }
      point.vx *= 0.72;
      point.vy *= 0.72;
    }

    if (iteration > 12 && maxDisplacement < 0.35) break;
  }

  // Deterministic collision relaxation. Even disconnected components cannot hide under each other.
  for (let pass = 0; pass < 40; pass += 1) {
    let moved = 0;
    const list = [...positions.values()];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minimum = a.radius + b.radius + 6;
        if (distance < minimum) {
          const overlap = (minimum - distance) / 2;
          const ux = dx / distance;
          const uy = dy / distance;
          if (!a.fixed) {
            a.x -= ux * overlap;
            a.y -= uy * overlap;
          }
          if (!b.fixed) {
            b.x += ux * overlap;
            b.y += uy * overlap;
          }
          moved += overlap;
        }
      }
    }
    if (moved < 0.05) break;
  }

  let overlapCount = 0;
  const list = [...positions.values()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const dx = list[j].x - list[i].x;
      const dy = list[j].y - list[i].y;
      if (Math.hypot(dx, dy) < list[i].radius + list[j].radius + 2) overlapCount += 1;
    }
  }

  const result: Record<string, { x: number; y: number }> = {};
  positions.forEach((point, id) => {
    result[id] = { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
  });
  const elapsedMs = Number((now() - start).toFixed(3));
  return {
    positions: result,
    iterations: completedIteration,
    elapsedMs,
    converged: maxDisplacement < 0.75 && overlapCount === 0,
    maxDisplacement: Number(maxDisplacement.toFixed(3)),
    overlapCount,
    width,
    height,
  };
}

export function makeBenchmarkGraph(nodeCount = 100, edgeCount = 150): { nodes: Required<Pick<LayoutNode, 'id'>>[]; edges: LayoutEdge[] } {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({ id: `n-${index}` }));
  const edges: LayoutEdge[] = [];
  let seed = 0x1234abcd;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const used = new Set<string>();
  for (let i = 1; i < nodeCount; i += 1) {
    const parent = Math.floor(random() * i);
    const key = `${parent}->${i}`;
    if (!used.has(key)) {
      used.add(key);
      edges.push({ source: `n-${parent}`, target: `n-${i}` });
    }
  }
  while (edges.length < edgeCount) {
    const a = Math.floor(random() * nodeCount);
    const b = Math.floor(random() * nodeCount);
    const key = `${Math.min(a, b)}->${Math.max(a, b)}`;
    if (a !== b && !used.has(key)) {
      used.add(key);
      edges.push({ source: `n-${Math.min(a, b)}`, target: `n-${Math.max(a, b)}` });
    }
  }
  return { nodes, edges };
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  const hr = (globalThis as { process?: { hrtime?: { bigint?: () => bigint } } }).process?.hrtime;
  if (hr?.bigint) return Number(hr.bigint()) / 1_000_000;
  return Date.now();
}
