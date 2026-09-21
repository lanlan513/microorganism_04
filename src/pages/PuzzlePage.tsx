import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Keyboard, Lightbulb, RotateCcw, ShieldCheck } from 'lucide-react';
import type {
  Assignment,
  HintReceipt,
  PublicPuzzleLevel,
  PuzzleHint,
  PuzzleVerdict,
} from '../../shared/puzzleTypes';
import { layoutNetwork, makeBenchmarkGraph } from '../../shared/forceLayout';
import { api } from '../utils/api';
import { PuzzleGraphBoard } from '../components/PuzzleGraphBoard';

interface LayoutBenchmark {
  nodeCount: number;
  linkCount: number;
  elapsedMs: number;
  iterations: number;
  converged: boolean;
  performanceBudgetMs: number;
  withinBudget: boolean;
}

function clientBenchmark(): LayoutBenchmark {
  const graph = makeBenchmarkGraph(100, 260);
  const result = layoutNetwork(graph.nodes, graph.links, { width: 1200, height: 800, iterations: 70, linkDistance: 92 });
  return {
    nodeCount: graph.nodes.length,
    linkCount: graph.links.length,
    elapsedMs: result.elapsedMs,
    iterations: result.iterations,
    converged: result.converged,
    performanceBudgetMs: 200,
    withinBudget: result.elapsedMs <= 200,
  };
}

export function PuzzlePage() {
  const [levels, setLevels] = useState<PublicPuzzleLevel[]>([]);
  const [activeLevelId, setActiveLevelId] = useState('');
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<PuzzleVerdict | null>(null);
  const [hint, setHint] = useState<PuzzleHint | null>(null);
  const [receipts, setReceipts] = useState<HintReceipt[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [benchmark, setBenchmark] = useState<LayoutBenchmark | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let mounted = true;
    api.getPuzzleLevels()
      .then((puzzleLevels) => {
        if (!mounted) return;
        setLevels(puzzleLevels);
        setActiveLevelId(puzzleLevels[0]?.id ?? '');
        setBenchmark(clientBenchmark());
      })
      .catch((reason: Error) => mounted && setError(reason.message))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeLevelId]);

  const level = useMemo(() => levels.find((item) => item.id === activeLevelId), [levels, activeLevelId]);
  const assignment = assignments[activeLevelId] ?? {};
  const proof = level?.proof;

  const updateAssignment = useCallback(
    (slotId: string, speciesId: string) => {
      if (!level) return;
      setError('');
      setVerdict(null);
      setAssignments((current) => {
        const previous = current[level.id] ?? {};
        const removedPrevious = Object.fromEntries(Object.entries(previous).filter(([, id]) => id !== speciesId));
        return { ...current, [level.id]: { ...removedPrevious, [slotId]: speciesId } };
      });
      setSelectedTokenId(null);
    },
    [level]
  );

  const clearSlot = useCallback(
    (slotId: string) => {
      if (!level) return;
      setVerdict(null);
      setAssignments((current) => {
        const previous = current[level.id] ?? {};
        const next = { ...previous };
        delete next[slotId];
        return { ...current, [level.id]: next };
      });
    },
    [level]
  );

  const resetLevel = () => {
    if (!level) return;
    setAssignments((current) => ({ ...current, [level.id]: {} }));
    setVerdict(null);
    setHint(null);
    setReceipts([]);
    setError('');
  };

  const selectLevel = (id: string) => {
    setActiveLevelId(id);
    setVerdict(null);
    setHint(null);
    setSelectedTokenId(null);
    setError('');
  };

  const submit = async () => {
    if (!level) return;
    setError('');
    try {
      const result = await api.submitPuzzle(level.id, assignment, receipts);
      setVerdict(result);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const requestHint = async (tier?: 1 | 2 | 3) => {
    if (!level) return;
    setError('');
    try {
      const result = await api.requestPuzzleHint(level.id, assignment, elapsed, tier);
      setHint(result);
      if (result.receipt) setReceipts((current) => [...current, result.receipt as HintReceipt]);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const filledCount = Object.keys(assignment).filter((slotId) => assignment[slotId]).length;

  if (loading) {
    return <div className="container mx-auto px-6 pb-24 pt-32 text-center text-text-muted">正在从服务端装载生态网络…</div>;
  }

  return (
    <div className="container mx-auto px-4 pb-24 pt-28 md:px-6">
      <header className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-glow-primary/30 bg-glow-primary/5 px-4 py-1.5 text-xs text-glow-primary">
          <ShieldCheck className="h-4 w-4" />
          服务端生成 · 服务端裁决 · 确定性结论
        </div>
        <h1 className="font-display text-4xl font-bold text-text-light md:text-6xl">生态关系网解谜</h1>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-text-muted md:text-base">
          每一关在服务端由构造性见证和最小不动点激活证明可解；浏览器只负责拖拽和显示。改 DOM、改分数或重复提交都不会改变裁决。
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-3">
        {levels.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectLevel(item.id)}
            className={`rounded-full border px-4 py-2 text-sm transition ${
              item.id === activeLevelId
                ? 'border-glow-primary bg-glow-primary/15 text-glow-primary'
                : 'border-white/10 bg-white/5 text-text-muted hover:text-white'
            }`}
          >
            {item.title}
            {item.proof.knownMultipleSolutions && <span className="ml-2 rounded-full bg-glow-purple/20 px-2 py-0.5 text-[10px]">多解</span>}
          </button>
        ))}
      </div>

      {level && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="glass-card p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold text-text-light">{level.title}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-text-muted">{level.intro}</p>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-text-muted">
                <Clock3 className="h-4 w-4" />
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              </div>
            </div>

            <PuzzleGraphBoard
              level={level}
              assignment={assignment}
              verdict={verdict}
              selectedTokenId={selectedTokenId}
              onDropOnSlot={updateAssignment}
              onClearSlot={clearSlot}
            />

            <div className="mt-5 rounded-2xl border border-glow-primary/15 bg-black/25 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold text-text-light">物种托盘（鼠标 / 触摸 / 键盘）</h3>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Keyboard className="h-4 w-4" />
                  Tab 聚焦物种，Enter 选择，再聚焦空位 Enter 放入
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {level.candidates.map((species) => {
                  const used = Object.values(assignment).includes(species.id);
                  const selected = selectedTokenId === species.id;
                  return (
                    <button
                      key={species.id}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', species.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onPointerDown={(event) => {
                        setSelectedTokenId(species.id);
                        try {
                          event.currentTarget.setPointerCapture(event.pointerId);
                        } catch {
                          // Some older mobile browsers do not support pointer capture; tap-to-place still works.
                        }
                      }}
                      onPointerUp={(event) => {
                        const target = document
                          .elementFromPoint(event.clientX, event.clientY)
                          ?.closest('[data-slot-id]') as HTMLElement | null;
                        const slotId = target?.dataset.slotId;
                        if (slotId) updateAssignment(slotId, species.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedTokenId(species.id);
                        }
                      }}
                      className={`touch-none rounded-xl border p-3 text-left transition ${
                        selected
                          ? 'border-glow-primary bg-glow-primary/15 shadow-glow'
                          : 'border-white/10 bg-white/5 hover:border-glow-primary/40'
                      } ${used ? 'opacity-45' : ''}`}
                      aria-pressed={selected}
                      aria-label={`${species.name}，${species.guild}。${used ? '已经放入网络' : '可拖拽或选择后放入空位'}`}
                    >
                      <div className="text-sm font-bold text-text-light">{species.name}</div>
                      <div className="mt-0.5 text-[11px] italic text-glow-primary/80">{species.scientificName}</div>
                      <div className="mt-2 text-xs leading-5 text-text-muted">{species.description}</div>
                      <div className="mt-2 text-[10px] text-text-muted">
                        {used ? '已放置' : selected ? '已选择：请点击一个空位' : species.guild}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" onClick={submit}>
                提交服务端裁决
              </button>
              <button type="button" className="btn-primary-ghost" onClick={resetLevel}>
                <RotateCcw className="h-4 w-4" />
                重置
              </button>
              <button type="button" className="btn-primary-ghost" onClick={() => requestHint()}>
                免费诊断
              </button>
              {[1, 2, 3].map((tier) => (
                <button
                  key={tier}
                  type="button"
                  disabled={elapsed < 120}
                  className="rounded-full border border-glow-purple/30 px-4 py-2 text-xs text-glow-purple disabled:cursor-not-allowed disabled:opacity-35"
                  onClick={() => requestHint(tier as 1 | 2 | 3)}
                >
                  {tier} 级提示 -{[10, 20, 35][tier - 1]} 分
                </button>
              ))}
              <span className="text-xs text-text-muted">已填 {filledCount}/{level.slots.length}</span>
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {hint && (
              <div className="mt-4 rounded-xl border border-glow-purple/30 bg-glow-purple/10 p-4">
                <div className="flex items-center gap-2 font-semibold text-glow-purple">
                  <Lightbulb className="h-4 w-4" />
                  {hint.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-text-light">{hint.message}</p>
              </div>
            )}

            {verdict && (
              <div
                className={`mt-5 rounded-2xl border p-4 ${
                  verdict.status === 'solved'
                    ? 'border-glow-primary/40 bg-glow-primary/10'
                    : 'border-red-400/30 bg-red-500/10'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  {verdict.status === 'solved' ? (
                    <CheckCircle2 className="h-6 w-6 text-glow-primary" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-red-300" />
                  )}
                  <div>
                    <div className="text-lg font-semibold text-text-light">{verdict.message}</div>
                    <div className="text-xs text-text-muted">
                      verdictHash: <code>{verdict.verdictHash.slice(0, 24)}…</code>
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-3xl font-bold text-text-light">{verdict.score}</div>
                    <div className="text-xs text-text-muted">扣分 {verdict.hintPenalty}</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {verdict.illegalEdges.map((edge) => (
                    <div key={`${edge.source}-${edge.target}-${edge.kind}`} className="rounded-lg bg-black/30 p-3 text-sm text-red-100">
                      <strong>非法关系：</strong>
                      {edge.label} — {edge.reason}
                    </div>
                  ))}
                  {verdict.collapsedNodes.map((node) => (
                    <div key={node.nodeId} className="rounded-lg bg-black/30 p-3 text-sm text-orange-100">
                      <strong>{node.reason === 'deadlocked' ? '死锁：' : node.reason === 'starved' ? '饿死：' : '连锁阻断：'}</strong>
                      {node.detail}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <div className="glass-card p-5">
              <h3 className="mb-3 text-lg font-semibold text-text-light">生成期证明</h3>
              {proof && (
                <dl className="space-y-2 text-xs leading-5 text-text-muted">
                  <ProofRow label="证明方法" value={proof.generatedBy} />
                  <ProofRow label="空位数 / 候选数" value={`${proof.slotCount} / ${proof.candidateCount}`} />
                  <ProofRow label="合法边" value={String(proof.legalEdgeCount)} />
                  <ProofRow label="激活节点" value={`${proof.activeNodeCount}/${proof.totalNodeCount}`} />
                  <ProofRow label="洗牌后见证仍成立" value={proof.shuffledAssignmentStillSolved ? '是' : '否'} />
                  <ProofRow label="多解政策" value="所有完整、合法、不坍塌网络均通过" />
                  <ProofRow label="见证指纹" value={proof.witnessFingerprint.slice(0, 20)} mono />
                </dl>
              )}
            </div>

            <div className="glass-card p-5">
              <h3 className="mb-3 text-lg font-semibold text-text-light">100 节点布局实测</h3>
              {benchmark ? (
                <>
                  <div className="text-4xl font-bold text-glow-primary">{benchmark.elapsedMs.toFixed(2)} ms</div>
                  <p className="mt-2 text-xs leading-5 text-text-muted">
                    {benchmark.nodeCount} 节点 / {benchmark.linkCount} 条边，{benchmark.iterations} 次迭代，预算 200ms。
                    碰撞分离保证节点半径加间距，不把多节点压成一团。
                  </p>
                  <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${benchmark.withinBudget ? 'bg-glow-primary/10 text-glow-primary' : 'bg-red-500/10 text-red-300'}`}>
                    {benchmark.withinBudget ? '通过预算' : '未通过预算'}
                  </div>
                </>
              ) : (
                <div className="text-xs text-text-muted">测量中…</div>
              )}
            </div>

            <div className="glass-card p-5 text-xs leading-6 text-text-muted">
              <h3 className="mb-2 text-sm font-semibold text-text-light">边界规则</h3>
              <ul className="list-disc space-y-1 pl-4">
                <li>非法关系直接拒绝，不进入成功判定。</li>
                <li>只允许服务端名单中的物种放入对应功能位。</li>
                <li>同一物种不能重复占用多个空位。</li>
                <li>互相等待且无外部激活源判定为死锁。</li>
                <li>多解关卡接受所有通过同一裁决函数的网络。</li>
                <li>卡住两分钟后才开放扣分级提示，三级也不直接显示答案。</li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function ProofRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className={`text-right text-text-light ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</dd>
    </div>
  );
}
