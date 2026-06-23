import { useRef, useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { UndirectedGraph } from "graphology";
import Sigma from "sigma";
import type { WikilinksData, WikilinksNode } from "../../services/wikilinks";
import GraphTooltip, { TYPE_COLORS } from "./GraphTooltip";

// ── Props ────────────────────────────────────────────────────────

interface GraphCanvasProps {
  graphData: WikilinksData;
  workspace: string;
  projectName: string;
  search: string;
  activeTypes: Set<string>;
  onSelectNode?: (key: string) => void;
}

// ── 辅助 ─────────────────────────────────────────────────────────

function computeLabelThreshold(nodes: WikilinksNode[]): number {
  const degrees = nodes.map((n) => n.degree).sort((a, b) => b - a);
  const idx = Math.max(0, Math.floor(degrees.length * 0.3) - 1);
  return degrees[idx] ?? 0;
}

// ── 组件 ─────────────────────────────────────────────────────────

export default function GraphCanvas({
  graphData, workspace, projectName, search, activeTypes, onSelectNode,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<UndirectedGraph | null>(null);
  const navigate = useNavigate();

  const [tooltipNode, setTooltipNode] = useState<WikilinksNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [layoutProgress, setLayoutProgress] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const workerRef = useRef<Worker | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  // ── 坐标写回 ──────────────────────────────────────────────────

  const persistCoordinates = useCallback(async () => {
    const g = graphRef.current;
    if (!g) return;

    const nodes = graphData.nodes;
    const updated: Record<string, WikilinksNode> = {};
    let anyNull = false;

    for (const key of Object.keys(nodes)) {
      const attrs = g.getNodeAttributes(key);
      updated[key] = {
        ...nodes[key],
        x: attrs.x ?? nodes[key].x,
        y: attrs.y ?? nodes[key].y,
      };
      if (updated[key].x == null || updated[key].y == null) anyNull = true;
    }

    if (anyNull) return;

    try {
      await invoke("write_file", {
        filePath: `${workspace}\\${projectName}\\wiki\\.wikilinks.json`,
        content: JSON.stringify({ ...graphData, nodes: updated }, null, 2),
      });
    } catch {}
  }, [graphData, workspace, projectName]);

  // ── 构建图 ─────────────────────────────────────────────────────

  const buildGraph = useCallback(() => {
    const g = new UndirectedGraph();
    const nodes = graphData.nodes;
    const labelThreshold = computeLabelThreshold(Object.values(nodes));
    const searchLower = search.toLowerCase().trim();

    for (const [key, node] of Object.entries(nodes)) {
      if (!activeTypes.has(node.type)) continue;
      if (searchLower) {
        const mTitle = node.title.toLowerCase().includes(searchLower);
        const mAlias = node.aliases.some((a) => a.toLowerCase().includes(searchLower));
        if (!mTitle && !mAlias) continue;
      }

      g.addNode(key, {
        x: node.x ?? Math.random() * 100 - 50,
        y: node.y ?? Math.random() * 100 - 50,
        size: Math.max(5, Math.min(28, 5 + node.degree * 3 + node.sources_count)),
        color: TYPE_COLORS[node.type] ?? "#888888",
        label: node.degree >= labelThreshold ? node.title : "",
        wikiType: node.type,
        title: node.title,
      });
    }

    for (const edge of graphData.edges) {
      if (g.hasNode(edge.source) && g.hasNode(edge.target) && !g.hasEdge(edge.source, edge.target)) {
        g.addEdge(edge.source, edge.target, {
          color: "#88888844",
          size: Math.max(0.5, Math.min(3, edge.score * 2)),
        });
      }
    }

    graphRef.current = g;
    return g;
  }, [graphData, search, activeTypes]);

  // ── 布局 Worker ────────────────────────────────────────────────

  const runLayout = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;

    const hasNullCoords = Object.values(graphData.nodes).some(
      (n) => n.x == null || n.y == null,
    );
    if (!hasNullCoords) return;

    setLayoutProgress("布局计算中…");

    workerRef.current?.terminate();
    const worker = new Worker(new URL("./graphWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const { type, positions } = e.data as {
        type: "progress" | "done";
        positions: Array<{ key: string; x: number; y: number }>;
      };
      for (const p of positions) {
        try { g.setNodeAttribute(p.key, "x", p.x); g.setNodeAttribute(p.key, "y", p.y); } catch {}
      }
      try { sigmaRef.current?.refresh(); } catch {}
      if (type === "done" && mountedRef.current) {
        setLayoutProgress(null);
        persistCoordinates();
      }
    };

    worker.onerror = () => { if (mountedRef.current) setLayoutProgress(null); };
    worker.postMessage({
      nodes: Object.values(graphData.nodes).map((n) => ({ key: n.key, x: n.x, y: n.y })),
      edges: graphData.edges.map((e) => ({ source: e.source, target: e.target, score: e.score })),
    });
  }, [graphData, persistCoordinates]);

  // ── Sigma 生命周期 ────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    const outer = containerRef.current;
    if (!outer) return;

    // 创建 sigma 专用内部 div（React 永不管其内部）
    const inner = document.createElement("div");
    inner.style.cssText = "position:absolute;inset:0;";
    outer.appendChild(inner);
    innerRef.current = inner;

    const g = buildGraph();
    const sigma = new Sigma(g, inner, {
      renderEdgeLabels: false,
      enableEdgeEvents: false,
      labelRenderedSizeThreshold: 8,
      labelDensity: 0.3,
      labelFont: "inherit",
      labelSize: 13,
      labelColor: { color: "var(--color-text)" },
      defaultNodeColor: "#888",
      defaultEdgeColor: "#88888844",
      defaultEdgeType: "line",
      stagePadding: 40,
      minCameraRatio: 0.05,
      maxCameraRatio: 2,
    });

    sigmaRef.current = sigma;

    // ── clickNode ──
    sigma.on("clickNode", (e) => {
      if (!mountedRef.current) return;
      const nk = e.node;
      const nd = graphData.nodes[nk];
      if (!nd) return;

      g.forEachNode((k) => g.setNodeAttribute(k, "highlighted", false));
      g.forEachEdge((k) => g.setEdgeAttribute(k, "highlighted", false));
      g.setNodeAttribute(nk, "highlighted", true);
      for (const nb of g.neighbors(nk)) g.setNodeAttribute(nb, "highlighted", true);
      g.forEachEdge((ek, _a, src, tgt) => {
        if (src === nk || tgt === nk) g.setEdgeAttribute(ek, "highlighted", true);
      });

      const typeColor = TYPE_COLORS[nd.type] ?? "#888";
      sigma.setSetting("nodeReducer", (_k, attrs) => {
        const hl = (attrs as Record<string, unknown>).highlighted;
        return {
          ...attrs,
          color: hl ? typeColor : "#88888820",
          label: hl ? (attrs.label as string) : "",
          size: hl ? (attrs.size as number) : (attrs.size as number) * 0.4,
        };
      });
      sigma.setSetting("edgeReducer", (_k, attrs) => {
        const hl = (attrs as Record<string, unknown>).highlighted;
        return { ...attrs, color: hl ? "#88888888" : "#88888808", size: hl ? (attrs.size as number) : 0.3 };
      });
      sigma.refresh();

      const { x, y } = sigma.getNodeDisplayData(nk) ?? {};
      if (x != null && y != null && mountedRef.current) {
        const rect = outer.getBoundingClientRect();
        setTooltipPos({ x: rect.left + x, y: rect.top + y });
      }
      setTooltipNode(nd);
      onSelectNode?.(nk);
    });

    // ── doubleClickNode ──
    sigma.on("doubleClickNode", (e) => {
      if (!mountedRef.current) return;
      const nd = graphData.nodes[e.node];
      if (!nd) return;
      navigate(`/project/${encodeURIComponent(projectName)}?file=wiki/${nd.type}/${nd.title}.md`);
    });

    // ── clickStage（取消选中） ──
    sigma.on("clickStage", () => {
      if (!mountedRef.current) return;
      g.forEachNode((k) => g.setNodeAttribute(k, "highlighted", false));
      g.forEachEdge((k) => g.setEdgeAttribute(k, "highlighted", false));
      sigma.setSetting("nodeReducer", null);
      sigma.setSetting("edgeReducer", null);
      sigma.refresh();
      setTooltipNode(null);
    });

    // ── hover label（用 nodeReducer 而非修改属性） ──
    sigma.on("enterNode", (e) => {
      if (!mountedRef.current) return;
      const title = g.getNodeAttribute(e.node, "title") as string;
      sigma.setSetting("nodeReducer", (_k, attrs) => ({
        ...attrs,
        label: (attrs as Record<string, unknown>).highlighted
          ? (attrs.label as string)
          : title,
      }));
      sigma.refresh();
    });
    sigma.on("leaveNode", () => {
      if (!mountedRef.current) return;
      sigma.setSetting("nodeReducer", null);
      sigma.refresh();
    });

    runLayout();

    return () => {
      mountedRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
      try { sigma.kill(); } catch {}
      sigmaRef.current = null;
      try { outer.removeChild(inner); } catch {}
      innerRef.current = null;
    };
  }, [
    graphData, search, activeTypes, buildGraph, runLayout,
    navigate, projectName, onSelectNode,
  ]);

  return (
    <div className="flex-1 relative min-h-0" ref={containerRef}>
      {layoutProgress && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5
                        rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent)]
                        text-xs animate-pulse">
          {layoutProgress}
        </div>
      )}
      {tooltipNode && (
        <div className="absolute inset-0 pointer-events-none z-30">
          <GraphTooltip
            node={tooltipNode}
            x={tooltipPos.x}
            y={tooltipPos.y}
            onOpenInEditor={() => {
              navigate(`/project/${encodeURIComponent(projectName)}?file=wiki/${tooltipNode.type}/${tooltipNode.title}.md`);
            }}
            onDismiss={() => setTooltipNode(null)}
          />
        </div>
      )}
    </div>
  );
}
