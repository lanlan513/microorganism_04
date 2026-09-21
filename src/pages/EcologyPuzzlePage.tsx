import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, KeyRound, MousePointer2, RotateCcw, Send, Sparkles } from 'lucide-react';
import { layoutGraph } from '../../shared/graphLayout';
import type { EcologyGrade, EcologyPuzzleResponse } from '../utils/ecologyApi';
import { ecologyApi } from '../utils/ecologyApi';

interface LevelSummary {
  id: string;
  name: string;
  biome: string;
  summary: string;
  source: string;
  blankCount: number;
  nodeCount: number;
}

type Assignment = Record<string, string>;

const RELATION_STYLE: Record<string, { color: string; dash?: string; label: string }> = {
  input: { color: '#38bdf8', label: '输入' },
  symbiosis: { color: '#22c55e', label: '共生' },
  syntrophy: { color: '#a3e635', dash: '6 4', label: '互养' },
  predation: { color: '#fb7185', label: '捕食' },
  competition: { color: '#f59e0b', dash: '2 5', label: '竞争' },
};

const FAILURE_COLOR: Record<string, string> = {
  'no-carbon-source': '#ef4444',
  'deadlock-cycle': '#a855f7',
  'upstream-collapse': '#f97316',
};

export function EcologyPuzzlePage() {
  const [levels, setLevels] = useState<LevelSummary[]>([]);
  const [puzzle, setPuzzle] = useState<EcologyPuzzleResponse | null>(null);
  const [assignment, setAssignment] = useState<Assignment>({});
  const [grade, setGrade] = useState<EcologyGrade | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hint, setHint] = useState<{ slotId: string; message: string; penalty: number } | null>(null);
  const [focusedToken, setFocusedToken] = useState<string | null>(null);
  const [focusedSlot, setFocusedSlot] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ speciesId: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ speciesId: string } | null>(null);
  const placeRef = useRef<(slotId: string, speciesId: string | null) => void>(() => {});

  useEffect(() => {
    ecologyApi.levels().then(setLevels).catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!puzzle) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Date.now() - puzzle.serverTime));
    }, 500);
    return () => window.clearInterval(timer);
  }, [puzzle]);

  const positions = useMemo(() => {
    if (!puzzle) return null;
    return layoutGraph(
      puzzle.slots.map((slot) => ({ id: slot.slotId, x: slot.x, y: slot.y, radius: 27, fixed: true })),
      puzzle.edges.map((edge) => ({ source: edge.source, target: edge.target })),
      { width: 900, height: 540, iterations: 1 },
    );
  }, [puzzle]);

  const placedSpecies = useMemo(() => {
    if (!puzzle) return new Map<string, { id: string; name: string }>();
    return new Map([...puzzle.bank, ...puzzle.lockedSpecies].map((species) => [species.id, species]));
  }, [puzzle]);

  async function start(levelId: string) {
    setLoading(true);
    setError('');
    setGrade(null);
    setHint(null);
    setAssignment({});
    try {
      const next = await ecologyApi.puzzle(levelId);
      setPuzzle(next);
      setElapsed(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '开局失败');
    } finally {
      setLoading(false);
    }
  }

  function place(slotId: string, speciesId: string | null) {
    const slot = puzzle?.slots.find((item) => item.slotId === slotId);
    if (!puzzle || slot?.locked) return;
    setAssignment((current) => {
      const next: Assignment = {};
      for (const [slot, species] of Object.entries(current)) {
        if (species !== speciesId) next[slot] = species;
      }
      if (speciesId) next[slotId] = speciesId;
      return next;
    });
    setGrade(null);
  }

  function startPointerDrag(event: React.PointerEvent, speciesId: string) {
    setFocusedToken(speciesId);
    dragRef.current = { speciesId };
    setDrag({ speciesId, x: event.clientX, y: event.clientY });
  }

  useEffect(() => {
    placeRef.current = place;
  });

  useEffect(() => {
    function move(event: PointerEvent) {
      if (!dragRef.current) return;
      event.preventDefault();
      setDrag({ ...dragRef.current, x: event.clientX, y: event.clientY });
    }
    function up(event: PointerEvent) {
      const currentDrag = dragRef.current;
      dragRef.current = null;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-slot-id]') as HTMLElement | null;
      if (target && currentDrag) placeRef.current(target.dataset.slotId!, currentDrag.speciesId);
      setDrag(null);
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  function onTokenKeyDown(event: React.KeyboardEvent, speciesId: string) {
    if (!puzzle) return;
    const blanks = puzzle.slots.filter((slot) => !slot.locked);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setFocusedToken((current) => (current === speciesId ? null : speciesId));
    }
    if (focusedToken === speciesId) {
      const index = blanks.findIndex((slot) => slot.slotId === focusedSlot);
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusedSlot(blanks[(index + 1 + blanks.length) % blanks.length].slotId);
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusedSlot(blanks[(index - 1 + blanks.length) % blanks.length].slotId);
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        place(focusedSlot ?? blanks[0].slotId, speciesId);
        setFocusedToken(null);
      }
      if (event.key === 'Escape') setFocusedToken(null);
    }
  }

  function onSlotKeyDown(event: React.KeyboardEvent, slotId: string) {
    if (focusedToken && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      place(slotId, focusedToken);
      setFocusedToken(null);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && assignment[slotId]) {
      event.preventDefault();
      place(slotId, null);
    }
  }

  async function submit() {
    if (!puzzle) return;
    setLoading(true);
    setError('');
    try {
      setGrade(await ecologyApi.grade({ puzzleId: puzzle.puzzleId, assignment }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '裁决失败');
    } finally {
      setLoading(false);
    }
  }

  async function requestHint(tier: 1 | 2 | 3) {
    if (!puzzle || !focusedSlot) return;
    try {
      const result = await ecologyApi.hint({ puzzleId: puzzle.puzzleId, slotId: focusedSlot, tier });
      setHint({ slotId: focusedSlot, message: result.message, penalty: result.penalty });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提示尚未解锁');
    }
  }

  const activeSet = new Set(grade?.activeSlots ?? []);
  const failedSlots = new Map(grade?.nodeFailures.map((failure) => [failure.slotId, failure]) ?? []);
  const invalidEdges = new Set(grade?.invalidRelations.map((violation) => violation.edgeId) ?? []);
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  const nextUnlock = elapsed < 120_000 ? 120_000 - elapsed : 0;

  return (
    <div className="pt-28 pb-16 px-4 md:px-8 max-w-7xl mx-auto">
      <header className="mb-8">
        <p className="text-glow-primary text-xs tracking-[0.35em] uppercase mb-3">Ecological Constraint Puzzle</p>
        <h1 className="text-3xl md:text-5xl font-display font-bold mb-4">
          <span className="text-gradient-primary">生态关系网解谜</span>
        </h1>
        <p className="text-text-muted max-w-3xl leading-7">
          服务端生成空位、洗牌并裁决。拖错后不是简单判错：整张网会按碳源传播过程显示饿死、上游坍塌或互相等待的死锁。
        </p>
      </header>

      {!puzzle ? (
        <div className="grid md:grid-cols-3 gap-5">
          {levels.map((level) => (
            <article key={level.id} className="glass-card p-6 flex flex-col min-h-[260px]">
              <h2 className="text-xl font-semibold mb-3 text-text-light">{level.name}</h2>
              <p className="text-sm text-text-muted leading-6 flex-1">{level.summary}</p>
              <div className="text-xs text-glow-primary/80 mt-4 mb-5">{level.nodeCount} 个节点 · {level.blankCount} 个空位</div>
              <button className="btn-primary w-full" onClick={() => start(level.id)} disabled={loading}>
                <MousePointer2 className="w-4 h-4" /> 开始解谜
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_330px] gap-6">
          <section className="glass-card p-4">
            <div className="flex flex-wrap gap-3 items-start justify-between mb-3">
              <div>
                <h2 className="text-2xl font-semibold">{puzzle.name}</h2>
                <p className="text-xs text-text-muted mt-1">同一提交反复提交将返回相同 decisionHash；改 DOM 不会影响服务端裁决。</p>
              </div>
              <div className="flex items-center gap-2 text-sm text-glow-gold glass-card px-3 py-2">
                <Clock3 className="w-4 h-4" /> {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
              </div>
            </div>

            <div className="overflow-auto rounded-xl border border-glow-primary/10 bg-[#071a17]">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${positions?.width ?? 900} ${positions?.height ?? 540}`}
                className="w-full min-w-[760px] h-[540px] touch-none"
                role="img"
                aria-label="生态关系图，可接收拖放物种"
              >
                {puzzle.edges.map((edge) => {
                  const a = positions?.positions[edge.source];
                  const b = positions?.positions[edge.target];
                  if (!a || !b) return null;
                  const style = RELATION_STYLE[edge.relation] ?? { color: '#94a3b8', label: edge.relation };
                  const bad = invalidEdges.has(edge.id);
                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const distance = Math.hypot(dx, dy) || 1;
                  const ux = dx / distance;
                  const uy = dy / distance;
                  const x2 = b.x - ux * 34;
                  const y2 = b.y - uy * 34;
                  return (
                    <g key={edge.id}>
                      <line
                        x1={a.x + ux * 34}
                        y1={a.y + uy * 34}
                        x2={x2}
                        y2={y2}
                        stroke={bad ? '#ef4444' : style.color}
                        strokeWidth={bad ? 3 : 1.8}
                        strokeDasharray={style.dash}
                        className={bad ? 'ecology-edge-fault' : undefined}
                        markerEnd={`url(#arrow-${edge.relation})`}
                        opacity={bad ? 1 : 0.72}
                      />
                      <title>{`${style.label}：${edge.description}`}</title>
                    </g>
                  );
                })}
                <defs>
                  {Object.entries(RELATION_STYLE).map(([relation, style]) => (
                    <marker key={relation} id={`arrow-${relation}`} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                      <path d="M0,0 L9,4.5 L0,9 Z" fill={style.color} />
                    </marker>
                  ))}
                </defs>

                {puzzle.slots.map((slot) => {
                  const point = positions?.positions[slot.slotId];
                  if (!point) return null;
                  const speciesId = slot.locked ? slot.lockedSpeciesId! : assignment[slot.slotId];
                  const species = slot.locked ? puzzle.bank.find((item) => item.id === speciesId) : placedSpecies.get(speciesId ?? '');
                  const failure = failedSlots.get(slot.slotId);
                  const isActive = activeSet.has(slot.slotId);
                  const fill = failure ? FAILURE_COLOR[failure.reason] : slot.locked ? '#164e63' : isActive && grade ? '#14532d' : '#0d2b26';
                  const focused = focusedSlot === slot.slotId;
                  return (
                    <g
                      key={slot.slotId}
                      transform={`translate(${point.x} ${point.y})`}
                      className={failure ? 'ecology-collapse' : undefined}
                      data-slot-id={slot.slotId}
                      tabIndex={slot.locked ? -1 : 0}
                      role="button"
                      aria-label={`${slot.label}${species ? `，当前：${species.name}` : '，空位'}${focusedToken ? '，按 Enter 放入选中物种' : ''}`}
                      onKeyDown={(event) => onSlotKeyDown(event, slot.slotId)}
                      onFocus={() => setFocusedSlot(slot.slotId)}
                      style={{ cursor: slot.locked ? 'default' : 'pointer', outline: 'none' }}
                    >
                      <circle
                        r="29"
                        fill={fill}
                        stroke={focused ? '#ffffff' : failure ? FAILURE_COLOR[failure.reason] : '#00ffc8'}
                        strokeWidth={focused ? 4 : 1.6}
                        opacity={grade && !isActive && !failure ? 0.45 : 1}
                      />
                      <text y={-4} textAnchor="middle" fill="#dff" fontSize="10" fontWeight="700">{slot.label}</text>
                      <text y={10} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="600">
                        {species?.name?.slice(0, 5) ?? '拖入'}
                      </text>
                      {failure && <text y="44" textAnchor="middle" fill={FAILURE_COLOR[failure.reason]} fontSize="10">{failure.reason === 'deadlock-cycle' ? '死锁' : '缺碳'}</text>}
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button className="btn-primary" onClick={submit} disabled={loading || Object.keys(assignment).length < puzzle.blankCount}>
                <Send className="w-4 h-4" /> 提交服务端裁决
              </button>
              <button className="btn-primary-ghost" onClick={() => { setAssignment({}); setGrade(null); setHint(null); }}>
                <RotateCcw className="w-4 h-4" /> 清空
              </button>
              <div className="text-xs text-text-muted flex items-center gap-2">
                <KeyRound className="w-4 h-4" /> 键盘：Tab 选物种，Enter 拿起，方向键选槽，Enter 放下，Delete 取出。
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="glass-card p-5">
              <h3 className="font-semibold mb-3">物种牌堆</h3>
              <div className="grid gap-2">
                {puzzle.bank.map((species) => {
                  const used = Object.values(assignment).includes(species.id);
                  const selected = focusedToken === species.id;
                  return (
                    <button
                      key={species.id}
                      onPointerDown={(event) => startPointerDrag(event, species.id)}
                      onClick={() => setFocusedToken((current) => (current === species.id ? null : species.id))}
                      onKeyDown={(event) => onTokenKeyDown(event, species.id)}
                      className={`text-left rounded-xl border px-3 py-2 transition ${
                        selected ? 'border-white bg-glow-primary/20' : 'border-glow-primary/20 bg-white/5'
                      } ${used ? 'opacity-35' : 'hover:border-glow-primary/70'}`}
                    >
                      <strong className="block text-sm">{species.name}</strong>
                      <span className="block text-[11px] text-text-muted leading-5">{species.role}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="glass-card p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-glow-gold" /> 分级提示（扣分）</h3>
              <p className="text-xs text-text-muted leading-5 mb-3">先在图上聚焦一个空位。提示不会给答案；三级分别扣 5、10、20 分。</p>
              {nextUnlock > 0 && <p className="text-xs text-glow-gold mb-3">一级提示还需 {Math.ceil(nextUnlock / 1000)} 秒解锁。</p>}
              <div className="grid grid-cols-3 gap-2">
                {([1, 2, 3] as const).map((tier) => (
                  <button key={tier} className="btn-primary-ghost text-xs" disabled={elapsed < [120_000, 180_000, 240_000][tier - 1]} onClick={() => requestHint(tier)}>
                    {tier} 级 -{[5, 10, 20][tier - 1]}
                  </button>
                ))}
              </div>
              {hint && <p className="text-xs leading-6 mt-3 text-glow-primary">{hint.message}</p>}
            </section>

            {grade && (
              <section className={`glass-card p-5 ${grade.verdict === 'accepted' ? 'glow-border' : ''}`}>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  {grade.verdict === 'accepted' ? <CheckCircle2 className="w-5 h-5 text-glow-primary" /> : <AlertTriangle className="w-5 h-5 text-glow-red" />}
                  裁决结果
                </h3>
                <p className="text-2xl font-bold mb-2">{grade.score} 分</p>
                <p className="text-xs text-text-muted leading-5 mb-3">{grade.message}</p>
                <dl className="text-xs space-y-2 text-text-muted">
                  <div><dt className="text-text-light">非法关系</dt><dd>{grade.invalidRelations.length}</dd></div>
                  <div><dt className="text-text-light">坍塌节点</dt><dd>{grade.nodeFailures.length}</dd></div>
                  <div><dt className="text-text-light">多解策略</dt><dd>{grade.solver.solutionCount === 'many' ? '存在多解，全部通过' : '本提交按完整约束判定'}</dd></div>
                  <div><dt className="text-text-light">决策哈希</dt><dd className="break-all">{grade.decisionHash.slice(0, 24)}…</dd></div>
                </dl>
                <div className="mt-3 max-h-44 overflow-auto text-[11px] space-y-2">
                  {grade.invalidRelations.map((item) => <p key={`${item.edgeId}-${item.reason}`} className="text-glow-red">{item.reason}</p>)}
                  {grade.nodeFailures.map((item) => <p key={item.slotId} style={{ color: FAILURE_COLOR[item.reason] }}>{item.name}：{item.detail}</p>)}
                </div>
              </section>
            )}

            <section className="glass-card p-5 text-[11px] text-text-muted leading-5">
              <h3 className="text-sm text-text-light font-semibold mb-2">生成期可解性承诺</h3>
              <p>洗牌后约束哈希：<span className="break-all">{puzzle.proofCommitment.shuffledConstraintHash.slice(0, 24)}…</span></p>
              <p>独立求解器：{String(puzzle.proofCommitment.solverSolutionCount)} 个以上解；规则 {puzzle.proofCommitment.rulesVersion}</p>
            </section>
          </aside>
        </div>
      )}
      {drag && (
        <div
          className="fixed z-[90] pointer-events-none rounded-lg border border-white bg-glow-primary/90 text-black px-3 py-2 text-xs font-bold shadow-2xl"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {placedSpecies.get(drag.speciesId)?.name ?? '物种'}
        </div>
      )}
      {error && <p className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-glow-red/90 text-white px-4 py-2 rounded-full text-sm">{error}</p>}
    </div>
  );
}
