import { Search, RefreshCw } from "lucide-react";
import { type WikiType, WIKI_TYPES } from "../../services/llm";

interface GraphToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  activeTypes: Set<WikiType>;
  onToggleType: (t: WikiType) => void;
  onRefresh: () => void;
  /** autocomplete 建议列表 */
  suggestions: string[];
  onSelectSuggestion: (key: string) => void;
}

/** 图谱顶部工具栏：搜索框 + 类型筛选 + 刷新按钮 */
export default function GraphToolbar({
  search,
  onSearchChange,
  activeTypes,
  onToggleType,
  onRefresh,
  suggestions,
  onSelectSuggestion,
}: GraphToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-sidebar)] shrink-0">
      {/* 搜索框 + autocomplete */}
      <div className="relative flex-1 max-w-sm">
        <Search
          size={16}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索节点…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-[var(--color-border)]
                     bg-[var(--color-bg)] text-[var(--color-text)] outline-none
                     focus:border-[var(--color-accent)] transition-colors"
        />
        {/* autocomplete 下拉 */}
        {search && suggestions.length > 0 && (
          <div
            className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto
                        rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]
                        shadow-lg z-30"
          >
            {suggestions.map((key) => {
              const [, title] = key.includes("/") ? key.split("/") : ["", key];
              return (
                <button
                  key={key}
                  onClick={() => onSelectSuggestion(key)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--color-accent-bg)]
                             text-[var(--color-text)] truncate"
                >
                  {title}
                  <span className="text-[var(--color-text-muted)] ml-2 text-xs">
                    {key.split("/")[0]}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 类型筛选 toggle */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {WIKI_TYPES.map((t) => {
          const active = activeTypes.has(t);
          return (
            <button
              key={t}
              onClick={() => onToggleType(t)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors border cursor-pointer whitespace-nowrap
                ${
                  active
                    ? "bg-[var(--color-accent-bg)] border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]"
                }`}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* 刷新 */}
      <button
        onClick={onRefresh}
        title="重建图谱索引"
        className="w-8 h-8 flex items-center justify-center rounded-md
                   text-[var(--color-text-muted)] hover:text-[var(--color-text)]
                   hover:bg-[var(--color-bg-tertiary)] cursor-pointer transition-colors"
      >
        <RefreshCw size={16} />
      </button>
    </div>
  );
}
