import { useRef, useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { UndirectedGraph } from "graphology";
import Sigma from "sigma";
import type { WikilinksData, WikilinksNode } from "../../services/wikilinks";
import GraphTooltip, { TYPE_COLORS } from "./GraphTooltip";
import RingNodeProgram from "./RingNodeProgram";

// ── Props ────────────────────────────────────────────────────────

interface GraphCanvasProps {
  graphData: WikilinksData;
  workspace: string;
  projectName: string;
  search: string;
  activeTypes: Set<string>;
  onSelectNode?: (key: string) => void;
  focusNodeKey?: string | null;
  onFocusHandled?: () => void;
}

// ── 组件 ─────────────────────────────────────────────────────────

export default function GraphCanvas({
  graphData, workspace, projectName, search, activeTypes, onSelectNode,
  focusNodeKey, onFocusHandled,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<UndirectedGraph | null>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const hoverGlowRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const [tooltipNode, setTooltipNode] = useState<WikilinksNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [layoutProgress, setLayoutProgress] = useState<string | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  // ref 供 afterRender 读取，避免闭包过期
  const selectedNodeKeyRef = useRef<string | null>(null);

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
    const searchLower = search.toLowerCase().trim();

    for (const [key, node] of Object.entries(nodes)) {
      if (!activeTypes.has(node.type)) continue;
      if (searchLower) {
        const mTitle = node.title.toLowerCase().includes(searchLower);
        const mAlias = (node.aliases ?? []).some((a) => a.toLowerCase().includes(searchLower));
        if (!mTitle && !mAlias) continue;
      }

      // 尺寸：degree（主导）+ sources（微调），范围 6~48
      const deg = node.degree;
      const src = (node.sources ?? []).length;
      const rawSize = 6 + Math.pow(deg, 0.7) * 7 + Math.pow(src, 0.6) * 3;

      g.addNode(key, {
        x: node.x ?? Math.random() * 100 - 50,
        y: node.y ?? Math.random() * 100 - 50,
        size: Math.max(6, Math.min(48, rawSize)),
        color: TYPE_COLORS[node.type] ?? "#888888",
        label: node.title,
        wikiType: node.type,
        title: node.title,
      });
    }

    for (const edge of graphData.edges) {
      if (g.hasNode(edge.source) && g.hasNode(edge.target) && !g.hasEdge(edge.source, edge.target)) {
        const isSuggested = edge.tier === "suggested";
        g.addEdge(edge.source, edge.target, {
          // strong: 粗实线 2~6px / suggested: 细线 0.6~1.4px
          size: isSuggested
            ? Math.max(0.6, Math.min(1.4, 0.4 + edge.score * 2.5))
            : Math.max(2, Math.min(6, 1.5 + edge.score * 4.5)),
          color: isSuggested ? "#bbbbbb" : "#888888",
          tier: edge.tier,
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

  // ── 搜索聚焦：相机飞行 ─────────────────────────────────────────

  useEffect(() => {
    if (!focusNodeKey || !sigmaRef.current || !graphRef.current) return;

    const sigma = sigmaRef.current;
    const g = graphRef.current;

    if (!g.hasNode(focusNodeKey)) {
      onFocusHandled?.();
      return;
    }

    const attrs = g.getNodeAttributes(focusNodeKey);
    const camera = sigma.getCamera();

    // 平滑飞向目标节点
    camera.animate(
      {
        x: (attrs.x as number) ?? 0,
        y: (attrs.y as number) ?? 0,
        ratio: 0.4,
      },
      { duration: 500 },
    );

    // 模拟 click 选中
    setTimeout(() => {
      if (!mountedRef.current) return;
      sigma.emit("clickNode", { node: focusNodeKey });
      onFocusHandled?.();
    }, 600);
  }, [focusNodeKey, onFocusHandled]);

  // ── Sigma 生命周期 ────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    const outer = containerRef.current;
    if (!outer) return;

    // 创建 sigma 专用内部 div
    const inner = document.createElement("div");
    inner.style.cssText = "position:absolute;inset:0;";
    outer.appendChild(inner);
    innerRef.current = inner;

    const g = buildGraph();
    const sigma = new Sigma(g, inner, {
      renderEdgeLabels: false,
      enableEdgeEvents: false,
      labelRenderedSizeThreshold: 4,
      labelDensity: 0.6,
      labelFont: "inherit",
      labelSize: 13,
      labelColor: { color: "var(--color-text)" },
      defaultNodeColor: "#888",
      defaultEdgeColor: "#888888",
      defaultEdgeType: "line",
      stagePadding: 40,
      minCameraRatio: 0.05,
      maxCameraRatio: 2,
      nodeProgramClasses: { "": RingNodeProgram },
    });

    sigmaRef.current = sigma;

    // ── afterRender：更新光圈位置（读 ref 避免闭包过期） ──
    sigma.on("afterRender", () => {
      const glow = glowRef.current;
      const nk = selectedNodeKeyRef.current;

      if (glow && nk) {
        const d = sigma.getNodeDisplayData(nk);
        if (d) {
          glow.style.left = `${d.x}px`;
          glow.style.top = `${d.y}px`;
        }
      }
    });

    // ── clickNode ──
    sigma.on("clickNode", (e) => {
      if (!mountedRef.current) return;
      const nk = e.node;
      const nd = graphData.nodes[nk];
      if (!nd) return;

      setSelectedNodeKey(nk);
      selectedNodeKeyRef.current = nk;

      g.forEachNode((k) => g.setNodeAttribute(k, "highlighted", false));
      g.forEachEdge((k) => g.setEdgeAttribute(k, "highlighted", false));
      g.setNodeAttribute(nk, "highlighted", true);
      for (const nb of g.neighbors(nk)) g.setNodeAttribute(nb, "highlighted", true);
      g.forEachEdge((ek, _a, src, tgt) => {
        if (src === nk || tgt === nk) g.setEdgeAttribute(ek, "highlighted", true);
      });

      applyClickReducer();
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
      setSelectedNodeKey(null);
      selectedNodeKeyRef.current = null;
      g.forEachNode((k) => g.setNodeAttribute(k, "highlighted", false));
      g.forEachEdge((k) => g.setEdgeAttribute(k, "highlighted", false));
      sigma.setSetting("nodeReducer", null);
      sigma.setSetting("edgeReducer", null);
      sigma.refresh();
      setTooltipNode(null);
      if (hoverGlowRef.current) {
        hoverGlowRef.current.style.visibility = "hidden";
      }
    });

    // ── 应用节点选中 reducer（提取复用：enterNode / leaveNode / clickNode 均调用） ──
    const applyClickReducer = () => {
      const nk = selectedNodeKeyRef.current;
      if (!nk) {
        sigma.setSetting("nodeReducer", null);
        sigma.setSetting("edgeReducer", null);
        return;
      }
      const nd = graphData.nodes[nk];
      if (!nd) return;
      const tc = TYPE_COLORS[nd.type] ?? "#888";
      sigma.setSetting("nodeReducer", (_k, attrs) => {
        const hl = (attrs as Record<string, unknown>).highlighted;
        return {
          ...attrs,
          color: hl ? (attrs.color as string) : `${(attrs.color as string).slice(0, 7)}18`,
          label: hl ? (attrs.label as string) : "",
          size: hl ? (attrs.size as number) : (attrs.size as number) * 0.45,
        };
      });
      sigma.setSetting("edgeReducer", (_k, attrs) => {
        const hl = (attrs as Record<string, unknown>).highlighted;
        const isSuggested = (attrs as Record<string, unknown>).tier === "suggested";
        return {
          ...attrs,
          color: hl ? tc : (isSuggested ? "#cccccc18" : "#88888814"),
          size: hl ? Math.max(2.5, (attrs.size as number) * 1.3) : (isSuggested ? 0.3 : 0.5),
        };
      });
    };

    // ── hover 光圈定位 + label ──
    sigma.on("enterNode", (e) => {
      if (!mountedRef.current) return;
      const hoveredKey = e.node;
      const hoveredTitle = g.getNodeAttribute(hoveredKey, "title") as string;
      const selKey = selectedNodeKeyRef.current;

      sigma.setSetting("nodeReducer", (_k, attrs) => {
        const a = attrs as Record<string, unknown>;
        const hl = a.highlighted;
        // 有选中节点时保持 dim 效果；hover 节点始终显示 label
        if (selKey) {
          return {
            ...attrs,
            color: hl ? (a.color as string) : `${(a.color as string).slice(0, 7)}18`,
            label: _k === hoveredKey ? hoveredTitle : hl ? (a.label as string) : "",
            size: hl ? (a.size as number) : (a.size as number) * 0.45,
          };
        }
        // 无选中节点：仅提升 hover 节点的 label
        if (_k === hoveredKey) {
          return { ...attrs, label: hoveredTitle };
        }
        return attrs;
      });
      sigma.refresh();

      // 定位 hover 光圈（已选中节点则不显示 hover 光圈）
      const d = sigma.getNodeDisplayData(hoveredKey);
      if (d && hoverGlowRef.current && !selKey) {
        hoverGlowRef.current.style.left = `${d.x}px`;
        hoverGlowRef.current.style.top = `${d.y}px`;
        hoverGlowRef.current.style.visibility = "visible";
      }
    });
    sigma.on("leaveNode", () => {
      if (!mountedRef.current) return;
      applyClickReducer();
      sigma.refresh();
      if (hoverGlowRef.current) {
        hoverGlowRef.current.style.visibility = "hidden";
      }
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

  // ── 渲染 ───────────────────────────────────────────────────────

  const typeGlowColor = selectedNodeKey
    ? (TYPE_COLORS[graphData.nodes[selectedNodeKey]?.type] ?? "#888")
    : "#888";

  return (
    <div
      className="flex-1 relative min-h-0"
      ref={containerRef}
      style={{
        // 点阵网格背景
        backgroundImage: "radial-gradient(circle, var(--color-border) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        backgroundPosition: "0 0",
      }}
    >
      {/* 选中节点光圈（WebGL 上层 CSS 叠加，afterRender 60fps 更新位置） */}
      <div
        ref={glowRef}
        className="absolute pointer-events-none z-10"
        style={{
          visibility: selectedNodeKey ? "visible" : "hidden",
          width: 80,
          height: 80,
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(circle, ${typeGlowColor}08 0%, ${typeGlowColor}22 40%, transparent 70%)`,
          borderRadius: "50%",
          filter: "blur(4px)",
        }}
      />

      {/* hover 光圈 */}
      <div
        ref={hoverGlowRef}
        className="absolute pointer-events-none z-10"
        style={{
          visibility: "hidden",
          width: 56,
          height: 56,
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(circle, #ffffff06 0%, #ffffff14 40%, transparent 70%)",
          borderRadius: "50%",
          filter: "blur(2px)",
        }}
      />

      {/* 布局进度 */}
      {layoutProgress && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5
                        rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent)]
                        text-xs animate-pulse">
          {layoutProgress}
        </div>
      )}

      {/* 节点详情 tooltip */}
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
