import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { IngestPlan, PlannedPage, PipelineState } from "../services/ingest";

interface Props {
  plan: IngestPlan;
  pipelineState: PipelineState;
  onClose: () => void;
  onConfirm: (plan: IngestPlan) => Promise<void>;
}

/** 按 create/update 分组的选中集合 */
interface SelectedSets {
  create: Set<number>;
  update: Set<number>;
}

export default function AnalysisModal({
  plan,
  pipelineState,
  onClose,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<SelectedSets>(() => ({
    create: new Set(plan.create.map((_, i) => i)),
    update: new Set(plan.update.map((_, i) => i)),
  }));
  const [diffIndex, setDiffIndex] = useState<{
    group: "update";
    index: number;
  } | null>(null);
  const [diffContent, setDiffContent] = useState("");
  const [loadingDiff, setLoadingDiff] = useState(false);

  const toggle = (group: "create" | "update", index: number) => {
    setSelected((prev) => {
      const next = new Set(prev[group]);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { ...prev, [group]: next };
    });
  };

  const confirmedPlan = useMemo((): IngestPlan => ({
    ...plan,
    create: plan.create.filter((_, i) => selected.create.has(i)),
    update: plan.update.filter((_, i) => selected.update.has(i)),
  }), [selected, plan]);

  const createCount = confirmedPlan.create.length;
  const updateCount = confirmedPlan.update.length;

  /** 加载已有页面内容 */
  async function handleLoadDiff(index: number) {
    const page = plan.update[index];
    if (!page?.existing_path) return;
    setDiffIndex({ group: "update", index });
    setLoadingDiff(true);
    try {
      const content: string = await invoke("read_wiki", {
        filePath: page.existing_path,
      });
      setDiffContent(content);
    } catch (e) {
      setDiffContent(`(无法读取: ${String(e)})`);
    } finally {
      setLoadingDiff(false);
    }
  }

  async function handleConfirm() {
    if (createCount + updateCount === 0) return;
    await onConfirm(confirmedPlan);
  }

  const typeColors: Record<string, string> = {
    "股票": "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    "概念": "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800",
    "模式": "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
    "市场环境": "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    "总结": "bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800",
  };

  const isRunning =
    pipelineState.status === "updating" ||
    pipelineState.status === "creating" ||
    pipelineState.status === "housekeeping";
  const isDone = pipelineState.status === "done";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col m-4">
        {/* ── 头部 ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-lg font-bold">变更计划</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {updateCount > 0 && `${updateCount} 个更新`}
              {updateCount > 0 && createCount > 0 && "，"}
              {createCount > 0 && `${createCount} 个新建`}
              {updateCount === 0 && createCount === 0 && "未选择任何操作"}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isRunning}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xl leading-none px-2 py-1 cursor-pointer
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✕
          </button>
        </div>

        {/* ── 分析摘要 ── */}
        {plan.analysisSummary && (
          <div className="px-6 py-3 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-secondary)] line-clamp-3">
              📋 {plan.analysisSummary}
            </p>
          </div>
        )}

        {/* ── 页面列表 ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 待更新 */}
          {plan.update.length > 0 && (
            <SectionCard
              title="待更新"
              icon="🔄"
              color="amber"
              pages={plan.update}
              selectedSet={selected.update}
              onToggle={(i) => toggle("update", i)}
              onViewDiff={handleLoadDiff}
              isDone={isDone}
              typeColors={typeColors}
            />
          )}

          {/* 待新建 */}
          {plan.create.length > 0 && (
            <SectionCard
              title="待新建"
              icon="✨"
              color="emerald"
              pages={plan.create}
              selectedSet={selected.create}
              onToggle={(i) => toggle("create", i)}
              onViewDiff={undefined}
              isDone={isDone}
              typeColors={typeColors}
            />
          )}
        </div>

        {/* ── 差异查看器 ── */}
        {diffIndex !== null && (
          <div className="border-t border-[var(--color-border)] max-h-64 overflow-y-auto p-4 bg-[var(--color-bg-secondary)]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">
                现有 Wiki: {plan.update[diffIndex.index]?.title}
              </h3>
              <button
                onClick={() => setDiffIndex(null)}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
              >
                收起
              </button>
            </div>
            {loadingDiff ? (
              <p className="text-xs text-[var(--color-text-muted)]">加载中...</p>
            ) : (
              <pre className="text-xs whitespace-pre-wrap font-mono bg-[var(--color-bg)] p-3 rounded border border-[var(--color-border)] max-h-48 overflow-y-auto">
                {diffContent || "(空内容)"}
              </pre>
            )}
          </div>
        )}

        {/* ── 进度展示 ── */}
        {isRunning && (
          <div className="border-t border-[var(--color-border)] px-6 py-3">
            {pipelineState.status === "updating" && (
              <StageProgressBar
                label="正在更新已有页面"
                progress={pipelineState.updateProgress}
              />
            )}
            {pipelineState.status === "creating" && (
              <StageProgressBar
                label="正在创建新页面"
                progress={pipelineState.createProgress}
              />
            )}
            {pipelineState.status === "housekeeping" && (
              <p className="text-sm text-[var(--color-accent)]">
                ⏳ 正在整理索引和日志...
              </p>
            )}
          </div>
        )}

        {/* ── 完成 ── */}
        {isDone && (
          <div className="border-t border-[var(--color-border)] px-6 py-3">
            {pipelineState.error ? (
              <div>
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  ⚠️ 部分完成
                </p>
                <pre className="text-xs mt-1 whitespace-pre-wrap text-[var(--color-text-muted)]">
                  {pipelineState.error.replace("部分成功:\n", "")}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                ✅ 所有页面已生成
              </p>
            )}
          </div>
        )}

        {/* ── 底部操作 ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-muted)]">
            已选择 {createCount + updateCount} 个变更
            （{updateCount} 更新 / {createCount} 新建）
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isRunning}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)]
                         hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDone ? "关闭" : "取消"}
            </button>
            {!isDone && (
              <button
                onClick={handleConfirm}
                disabled={
                  createCount + updateCount === 0 || isRunning
                }
                className="px-6 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium
                           hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRunning
                  ? "执行中..."
                  : `执行计划（${createCount + updateCount}）`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 子组件 ────────────────────────────────────────────────────────

/** 一个分区：待更新 或 待新建 */
function SectionCard({
  title,
  icon,
  color,
  pages,
  selectedSet,
  onToggle,
  onViewDiff,
  isDone,
  typeColors,
}: {
  title: string;
  icon: string;
  color: string;
  pages: PlannedPage[];
  selectedSet: Set<number>;
  onToggle: (index: number) => void;
  onViewDiff?: (index: number) => void;
  isDone: boolean;
  typeColors: Record<string, string>;
}) {
  const colorClasses: Record<string, string> = {
    amber: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
    emerald: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
  };

  return (
    <div
      className={`rounded-lg border ${colorClasses[color] || ""} overflow-hidden`}
    >
      {/* 分区标题 */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/30 dark:bg-black/10">
        <h3 className="text-sm font-semibold">
          {icon} {title}（{pages.length}）
        </h3>
      </div>

      {/* 页面列表 */}
      <div className="divide-y divide-[var(--color-border)]">
        {pages.map((page, i) => (
          <div
            key={`${page.type}-${page.title}-${i}`}
            className={`flex items-start gap-3 px-4 py-3 transition-colors
              ${selectedSet.has(i)
                ? "bg-white/60 dark:bg-white/5"
                : "opacity-50"
              }
              ${isDone ? "" : "cursor-pointer"}
            `}
            onClick={() => !isDone && onToggle(i)}
          >
            <input
              type="checkbox"
              checked={selectedSet.has(i)}
              onChange={() => onToggle(i)}
              disabled={isDone}
              className="mt-0.5 cursor-pointer"
            />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${typeColors[page.type] || ""}`}
                >
                  {page.type}
                </span>
                <span className="font-semibold text-sm">{page.title}</span>
              </div>

              {/* 元数据 */}
              <PageMeta page={page} />

              {/* 变更理由 */}
              {page.rationale && (
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  📝 {page.rationale}
                </p>
              )}

              {/* 查看现有按钮 */}
              {onViewDiff && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewDiff(i);
                  }}
                  className="mt-1 text-xs text-[var(--color-accent)] hover:underline cursor-pointer"
                >
                  📄 查看现有 Wiki
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 页面元数据行 */
function PageMeta({ page }: { page: PlannedPage }) {
  const parts: string[] = [];

  if (page.aliases && page.aliases.length > 0) {
    parts.push(`别名: ${page.aliases.join("、")}`);
  }
  if (page.type === "股票") {
    if (page.code) parts.push(`代码: ${page.code}`);
    if (page.industry) parts.push(`行业: ${page.industry}`);
    if (page.concepts && page.concepts.length > 0) {
      parts.push(`概念: ${page.concepts.join("、")}`);
    }
  }
  if (page.type === "概念") {
    if (page.parent) parts.push(`父概念: ${page.parent}`);
    if (page.catalysts && page.catalysts.length > 0) {
      parts.push(`催化事件: ${page.catalysts.join("、")}`);
    }
  }

  if (parts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-[var(--color-text-muted)]">
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </div>
  );
}

/** 阶段进度条 */
function StageProgressBar({
  label,
  progress,
}: {
  label: string;
  progress: { total: number; completed: number; failed: number; currentTitle: string | null };
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--color-text-secondary)]">
          {label}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">
          {progress.completed + progress.failed}/{progress.total}
          {progress.failed > 0 && `（${progress.failed} 失败）`}
        </span>
      </div>
      <div className="w-full h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
          style={{
            width: `${((progress.completed + progress.failed) / progress.total) * 100}%`,
          }}
        />
      </div>
      {progress.currentTitle && (
        <p className="text-xs text-[var(--color-text-muted)] mt-1 truncate">
          正在处理: {progress.currentTitle}
        </p>
      )}
    </div>
  );
}
