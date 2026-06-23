import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import { type WikiType, WIKI_TYPES } from "../services/llm";
import { rebuildWikilinks, readWikilinks } from "../services/wikilinks";
import GraphToolbar from "../components/graph/GraphToolbar";
import GraphCanvas from "../components/graph/GraphCanvas";

/** 全屏图谱页面 */
export default function GraphPage() {
  const { projectName } = useParams<{ projectName: string }>();
  const decodedName = decodeURIComponent(projectName ?? "");

  const workspace = useAppStore((s) => s.workspace);
  const graphData = useAppStore((s) => s.graphData);
  const graphLoading = useAppStore((s) => s.graphLoading);
  const setGraphData = useAppStore((s) => s.setGraphData);
  const setGraphLoading = useAppStore((s) => s.setGraphLoading);
  const setError = useAppStore((s) => s.setError);

  const [search, setSearch] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<WikiType>>(
    () => new Set(WIKI_TYPES),
  );

  // ── 加载数据 ──

  const loadData = useCallback(async () => {
    if (!workspace || !decodedName) return;
    setGraphLoading(true);
    try {
      const data = await readWikilinks(workspace, decodedName);
      setGraphData(data);
    } catch {
      // 文件不存在 → 空状态
      setGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  }, [workspace, decodedName, setGraphData, setGraphLoading]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── 刷新（重建索引 + 重载） ──

  const handleRefresh = useCallback(async () => {
    if (!decodedName) return;
    setGraphLoading(true);
    try {
      await rebuildWikilinks(decodedName);
      if (workspace) {
        const data = await readWikilinks(workspace, decodedName);
        setGraphData(data);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGraphLoading(false);
    }
  }, [decodedName, workspace, setGraphData, setGraphLoading, setError]);

  // ── 类型 toggle ──

  const handleToggleType = useCallback((t: WikiType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        if (next.size > 1) next.delete(t); // 至少保留一个
      } else {
        next.add(t);
      }
      return next;
    });
  }, []);

  // ── 搜索 autocomplete ──

  const suggestions =
    search && graphData
      ? Object.keys(graphData.nodes).filter((key) => {
          const node = graphData.nodes[key];
          const s = search.toLowerCase();
          return (
            node.title.toLowerCase().includes(s) ||
            node.aliases.some((a) => a.toLowerCase().includes(s))
          );
        })
      : [];

  const handleSelectSuggestion = useCallback(
    (_key: string) => {
      setSearch(""); // 清空搜索，让 GraphCanvas 处理聚焦
    },
    [],
  );

  // ── 空状态 ──

  if (!graphLoading && (!graphData || Object.keys(graphData.nodes).length === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-center max-w-sm">
          <p className="text-4xl mb-4">🕸️</p>
          <p className="text-lg font-semibold text-[var(--color-text)] mb-2">
            暂无知识图谱
          </p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            在文件视图中右键源文件选择「🤖 分析生成 Wiki」，完成导入后即可在此查看知识图谱。
          </p>
          {decodedName && (
            <button
              onClick={handleRefresh}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)]
                         text-white hover:opacity-90 cursor-pointer transition-opacity"
            >
              尝试构建图谱
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── 加载中 ──

  if (graphLoading || !graphData) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--color-bg)]">
        <p className="text-sm text-[var(--color-text-muted)] animate-pulse">
          加载图谱…
        </p>
      </div>
    );
  }

  // ── 图谱 ──

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)]">
      <GraphToolbar
        search={search}
        onSearchChange={setSearch}
        activeTypes={activeTypes}
        onToggleType={handleToggleType}
        onRefresh={handleRefresh}
        suggestions={suggestions}
        onSelectSuggestion={handleSelectSuggestion}
      />
      <GraphCanvas
        graphData={graphData}
        workspace={workspace ?? ""}
        projectName={decodedName}
        search={search}
        activeTypes={activeTypes}
      />
    </div>
  );
}
