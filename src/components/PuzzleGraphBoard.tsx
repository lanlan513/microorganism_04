import { useMemo } from 'react';
import { RELATION_LABELS, type PublicPuzzleLevel, type PuzzleVerdict, type RelationKind } from '../../shared/puzzleTypes';
import { layoutNetwork } from '../../shared/forceLayout';

interface PuzzleGraphBoardProps {
  level: PublicPuzzleLevel;
  assignment: Record<string, string>;
  verdict: PuzzleVerdict | null;
  selectedTokenId: string | null;
  onDropOnSlot: (slotId: string, speciesId: string) => void;
  onClearSlot: (slotId: string) => void;
}

const relationColor: Record<RelationKind, string> = {
  'resource-supply': '#f1c40f',
  symbiosis: '#00ffc8',
  competition: '#ff7a59',
  'cross-feeding': '#7aa2ff',
  predation: '#ff5f8f',
};

function nodeLayer(kind: string, placeholder: boolean): number {
  if (kind === 'resource') return 0;
  if (kind === 'producer') return placeholder ? 2 : 1;
  if (kind === 'host') return 2;
  if (kind === 'decomposer') return 3;
  return placeholder ? 2 : 3;
}

export function PuzzleGraphBoard({ level, assignment, verdict, selectedTokenId, onDropOnSlot, onClearSlot }: PuzzleGraphBoardProps) {
  const layout = useMemo(() => {
    const nodes = level.nodes.map((node) => ({
      id: node.id,
      radius: node.placeholder ? 58 : 46,
      layer: nodeLayer(node.kind, node.placeholder),
    }));
    return layoutNetwork(nodes, level.edges.map((edge) => ({ source: edge.source, target: edge.target })), {
      width: 1120,
      height: 760,
      iterations: 58,
      linkDistance: 120,
      nodePadding: 14,
    });
  }, [level]);

  const placedById = useMemo(() => new Map(level.candidates.map((species) => [species.id, species])), [level]);
  const activeSet = new Set(verdict?.activeNodeIds ?? []);
  const inactiveSet = new Set(verdict?.inactiveNodeIds ?? []);
  const illegalKeySet = new Set((verdict?.illegalEdges ?? []).map((edge) => `${edge.source}->${edge.target}:${edge.kind}`));

  return (
    <div className="relative w-full aspect-[1120/760] overflow-hidden rounded-2xl border border-glow-primary/20 bg-[#061513]/90">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`${level.title}生态关系图`}>
        <defs>
          <marker id="arrow-default" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
          {(Object.keys(relationColor) as RelationKind[]).map((kind) => (
            <marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={relationColor[kind]} />
            </marker>
          ))}
        </defs>

        {level.edges.map((edge) => {
          const a = layout.positions[edge.source];
          const b = layout.positions[edge.target];
          if (!a || !b) return null;
          const key = `${edge.source}->${edge.target}:${edge.kind}`;
          const illegal = illegalKeySet.has(key);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const ux = dx / distance;
          const uy = dy / distance;
          return (
            <g key={key} className={illegal ? 'animate-pulse' : undefined}>
              <line
                x1={a.x + ux * 24}
                y1={a.y + uy * 24}
                x2={b.x - ux * 34}
                y2={b.y - uy * 34}
                stroke={illegal ? '#ff3b3b' : relationColor[edge.kind]}
                strokeWidth={illegal ? 3 : 1.8}
                strokeDasharray={edge.kind === 'competition' ? '7 5' : edge.kind === 'cross-feeding' ? '3 4' : undefined}
                markerEnd={`url(#arrow-${edge.kind})`}
                opacity={illegal ? 0.95 : 0.68}
              />
              <title>{`${edge.label}（${RELATION_LABELS[edge.kind]}）${illegal ? '：非法关系' : ''}`}</title>
            </g>
          );
        })}
      </svg>

      {level.nodes.map((node) => {
        const point = layout.positions[node.id];
        if (!point) return null;
        const placedId = node.placeholder ? assignment[node.id] : undefined;
        const placed = placedId ? placedById.get(placedId) : undefined;
        const active = activeSet.has(node.id);
        const inactive = inactiveSet.has(node.id);
        const borderColor = node.placeholder
          ? inactive
            ? '#ff4d4d'
            : active
              ? '#00ffc8'
              : '#5c807a'
          : activeSet.size === 0 || active || node.kind === 'resource'
            ? relationColor['resource-supply']
            : '#ff4d4d';

        return (
          <div
            key={node.id}
            className="absolute w-32 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(point.x / layout.width) * 100}%`, top: `${(point.y / layout.height) * 100}%` }}
          >
            {node.placeholder ? (
              <div
                role="button"
                tabIndex={0}
                aria-label={`空位 ${node.name}，等待放置${node.acceptsGuild}。${selectedTokenId ? '按 Enter 或空格放入当前物种' : '请先在下方选择物种'}`}
                data-slot-id={node.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const speciesId = event.dataTransfer.getData('text/plain');
                  if (speciesId) onDropOnSlot(node.id, speciesId);
                }}
                onClick={() => {
                  if (selectedTokenId) onDropOnSlot(node.id, selectedTokenId);
                }}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && selectedTokenId) {
                    event.preventDefault();
                    onDropOnSlot(node.id, selectedTokenId);
                  }
                }}
                className="min-h-20 rounded-xl border-2 border-dashed bg-black/45 p-2 text-center backdrop-blur-sm transition focus:outline-none focus:ring-2 focus:ring-glow-primary"
                style={{ borderColor, boxShadow: inactive ? '0 0 22px rgba(255,77,77,.35)' : active ? '0 0 18px rgba(0,255,200,.25)' : undefined }}
              >
                <div className="text-[11px] font-bold text-text-light">{node.name}</div>
                <div className="mt-1 text-[10px] leading-tight text-glow-primary">{placed ? placed.name : node.acceptsGuild}</div>
                {placed && (
                  <button
                    type="button"
                    className="mt-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-text-muted hover:text-white"
                    onClick={() => onClearSlot(node.id)}
                  >
                    取出
                  </button>
                )}
                <div className="mt-1 text-[9px] leading-tight text-text-muted">{node.clue}</div>
              </div>
            ) : (
              <div
                className="min-h-16 rounded-xl border bg-black/55 p-2 text-center backdrop-blur-sm"
                style={{ borderColor: `${borderColor}66`, opacity: inactive ? 0.45 : 1 }}
              >
                <div className="text-[11px] font-bold text-text-light">{node.name}</div>
                <div className="mt-0.5 text-[10px] text-text-muted">{node.guild}</div>
              </div>
            )}
          </div>
        );
      })}

      <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 rounded-xl bg-black/45 p-2 text-[10px]">
        {(Object.keys(relationColor) as RelationKind[]).map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1 text-text-muted">
            <i className="inline-block h-0.5 w-5" style={{ background: relationColor[kind] }} />
            {RELATION_LABELS[kind]}
          </span>
        ))}
      </div>
    </div>
  );
}
