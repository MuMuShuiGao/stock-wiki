import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PreAnalysisEntity } from "../services/llm";
import { useAppStore } from "../stores/appStore";

interface Props {
  projectName: string;
  sourceText: string;
  entities: PreAnalysisEntity[];
  onClose: () => void;
}

export default function AnalysisModal({
  projectName,
  sourceText,
  entities,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(() => {
    // Select all by default
    return new Set(entities.map((_, i) => i));
  });
  const [diffEntityIndex, setDiffEntityIndex] = useState<number | null>(null);
  const [diffContent, setDiffContent] = useState<string>("");
  const [loadingDiff, setLoadingDiff] = useState(false);

  const {
    pipelineStatus,
    confirmAndGenerate,
  } = useAppStore();

  const toggleEntity = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelected(next);
  };

  const confirmedEntities = useMemo(
    () => entities.filter((_, i) => selected.has(i)),
    [selected, entities],
  );

  const createCount = useMemo(
    () => confirmedEntities.filter((e) => e.action === "create").length,
    [confirmedEntities],
  );

  const updateCount = useMemo(
    () => confirmedEntities.filter((e) => e.action === "update").length,
    [confirmedEntities],
  );

  async function handleLoadDiff(index: number) {
    const entity = entities[index];
    if (!entity.existing_path) return;

    setDiffEntityIndex(index);
    setLoadingDiff(true);
    try {
      const content: string = await invoke("read_wiki", {
        filePath: entity.existing_path,
      });
      setDiffContent(content);
    } catch (e) {
      setDiffContent(`(无法读取现有内容: ${String(e)})`);
    } finally {
      setLoadingDiff(false);
    }
  }

  async function handleGenerate() {
    if (confirmedEntities.length === 0) return;
    await confirmAndGenerate(projectName, sourceText, confirmedEntities);
  }

  const typeColors: Record<string, string> = {
    "股票": "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    "概念": "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800",
    "模式": "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  };

  const isGenerating = pipelineStatus === "generating";
  const isDone = pipelineStatus === "done";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-lg font-bold">预分析结果</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              扫描到 {entities.length} 个实体
              {createCount > 0 && `，${createCount} 个新建`}
              {updateCount > 0 && `，${updateCount} 个更新`}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xl leading-none px-2 py-1 cursor-pointer
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✕
          </button>
        </div>

        {/* Entity list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {entities.map((entity, i) => (
            <div
              key={`${entity.type}-${entity.title}-${i}`}
              className={`flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors
                ${selected.has(i)
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                  : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] opacity-60"
                }
                ${isDone ? "" : "cursor-pointer"}
              `}
              onClick={() => !isDone && toggleEntity(i)}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggleEntity(i)}
                disabled={isDone}
                className="mt-0.5 cursor-pointer"
              />

              {/* Entity info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border ${typeColors[entity.type] || ""}`}
                  >
                    {entity.type}
                  </span>
                  <span className="font-semibold text-sm">{entity.title}</span>
                  {entity.action === "update" && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                      🔄 更新
                    </span>
                  )}
                  {entity.action === "create" && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      ✨ 新建
                    </span>
                  )}
                </div>

                {/* Stock extra fields */}
                {entity.type === "股票" && (
                  <div className="flex gap-2 mt-1 text-xs text-[var(--color-text-muted)]">
                    {entity.code && <span>代码: {entity.code}</span>}
                    {entity.industry && <span>行业: {entity.industry}</span>}
                    {entity.concepts && entity.concepts.length > 0 && (
                      <span>
                        概念: {entity.concepts.join("、")}
                      </span>
                    )}
                  </div>
                )}

                {/* View diff button for updates */}
                {entity.action === "update" && entity.existing_path && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadDiff(i);
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

        {/* Diff viewer */}
        {diffEntityIndex !== null && (
          <div className="border-t border-[var(--color-border)] max-h-64 overflow-y-auto p-4 bg-[var(--color-bg-secondary)]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">
                现有 Wiki: {entities[diffEntityIndex]?.title}
              </h3>
              <button
                onClick={() => setDiffEntityIndex(null)}
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
            <p className="text-xs text-[var(--color-text-muted)] mt-2">
              ℹ️ 此 Wiki 已存在。LLM 将智能合并新旧内容，生成后请通过差异视图审查变更。
            </p>
          </div>
        )}

        {/* Status messages */}
        {isGenerating && (
          <div className="border-t border-[var(--color-border)] px-6 py-3 text-sm text-[var(--color-accent)]">
            ⏳ 正在生成 Wiki 页面...
          </div>
        )}
        {isDone && (
          <div className="border-t border-[var(--color-border)] px-6 py-3 text-sm text-emerald-600 dark:text-emerald-400">
            ✅ Wiki 页面已生成！
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-muted)]">
            已选择 {confirmedEntities.length} / {entities.length} 个实体
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isGenerating}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)]
                         hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDone ? "关闭" : "取消"}
            </button>
            {!isDone && (
              <button
                onClick={handleGenerate}
                disabled={confirmedEntities.length === 0 || isGenerating}
                className="px-6 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium
                           hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating
                  ? "生成中..."
                  : `生成 ${confirmedEntities.length} 个 Wiki`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
