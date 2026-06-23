import type { WikilinksNode } from "../../services/wikilinks";

interface GraphTooltipProps {
  node: WikilinksNode;
  x: number;
  y: number;
  onOpenInEditor: () => void;
  onDismiss: () => void;
}

export const TYPE_COLORS: Record<string, string> = {
  股票: "#ef4444",
  概念: "#3b82f6",
  模式: "#22c55e",
  市场环境: "#f59e0b",
  总结: "#8b5cf6",
};

/** 节点悬浮 tooltip：类型标签 + 标题 + 摘要 + 统计信息 */
export default function GraphTooltip({
  node,
  x,
  y,
  onOpenInEditor,
  onDismiss,
}: GraphTooltipProps) {
  return (
    <div
      className="absolute z-50 pointer-events-auto"
      style={{ left: x + 15, top: y - 10 }}
    >
      <div
        className="bg-[var(--color-bg)] border border-[var(--color-border)]
                   rounded-lg shadow-xl p-3 max-w-xs text-sm"
      >
        {/* 类型 + 标题 */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: TYPE_COLORS[node.type] ?? "#888" }}
          />
          <span className="text-xs text-[var(--color-text-muted)]">
            {node.type}
          </span>
          <button
            onClick={onDismiss}
            className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text)]
                       text-xs leading-none px-1"
          >
            ✕
          </button>
        </div>

        <p className="font-semibold text-[var(--color-text)] mb-1">
          {node.title}
        </p>

        {node.summary && (
          <p className="text-xs text-[var(--color-text-secondary)] mb-2 line-clamp-3">
            {node.summary}
          </p>
        )}

        {/* 统计 */}
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span>关联数 {node.degree}</span>
          <span>来源 {node.sources_count}</span>
        </div>

        {/* 操作 */}
        <button
          onClick={onOpenInEditor}
          className="mt-2 w-full text-xs px-2 py-1 rounded bg-[var(--color-accent-bg)]
                     text-[var(--color-accent)] hover:opacity-80 cursor-pointer transition-opacity"
        >
          打开文件
        </button>
      </div>
    </div>
  );
}
