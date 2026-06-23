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

/** 节点悬浮 tooltip：类型色条 + 标题 + 摘要 + 统计卡片 */
export default function GraphTooltip({
  node,
  x,
  y,
  onOpenInEditor,
  onDismiss,
}: GraphTooltipProps) {
  const typeColor = TYPE_COLORS[node.type] ?? "#888";

  return (
    <div
      className="absolute z-50 pointer-events-auto"
      style={{ left: x + 16, top: y - 12 }}
    >
      <div
        className="bg-[var(--color-bg)] border border-[var(--color-border)]
                   rounded-xl shadow-2xl overflow-hidden"
        style={{ width: 260 }}
      >
        {/* 顶部色条 */}
        <div className="h-1" style={{ backgroundColor: typeColor }} />

        <div className="p-3.5">
          {/* 类型标签 + 关闭 */}
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{
                backgroundColor: `${typeColor}18`,
                color: typeColor,
                border: `1px solid ${typeColor}33`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: typeColor }}
              />
              {node.type}
            </span>
            <button
              onClick={onDismiss}
              className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text)]
                         text-xs leading-none px-1 cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* 标题 */}
          <p className="font-semibold text-[var(--color-text)] text-sm mb-2 leading-tight">
            {node.title}
          </p>

          {/* 摘要 */}
          {node.summary && (
            <p className="text-xs text-[var(--color-text-secondary)] mb-3 leading-relaxed line-clamp-3">
              {node.summary}
            </p>
          )}

          {/* 统计卡片 */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 rounded-lg bg-[var(--color-bg-tertiary)] px-2.5 py-1.5 text-center">
              <p className="text-xs text-[var(--color-text-muted)]">关联</p>
              <p className="text-sm font-semibold text-[var(--color-text)]">{node.degree}</p>
            </div>
            <div className="flex-1 rounded-lg bg-[var(--color-bg-tertiary)] px-2.5 py-1.5 text-center">
              <p className="text-xs text-[var(--color-text-muted)]">来源</p>
              <p className="text-sm font-semibold text-[var(--color-text)]">{(node.sources ?? []).length}</p>
            </div>
            <div className="flex-1 rounded-lg bg-[var(--color-bg-tertiary)] px-2.5 py-1.5 text-center">
              <p className="text-xs text-[var(--color-text-muted)]">别名</p>
              <p className="text-sm font-semibold text-[var(--color-text)]">{(node.aliases ?? []).length}</p>
            </div>
          </div>

          {/* 操作按钮 */}
          <button
            onClick={onOpenInEditor}
            className="w-full text-xs px-3 py-1.5 rounded-lg font-medium cursor-pointer
                       transition-all duration-150 hover:opacity-85"
            style={{
              backgroundColor: `${typeColor}18`,
              color: typeColor,
            }}
          >
            Open in Editor ↗
          </button>
        </div>
      </div>
    </div>
  );
}
