/**
 * ForceAtlas2 布局 Web Worker。
 * 接收节点+边数据 → graphology 建图 → ForceAtlas2 迭代 → 回传坐标。
 */

import { UndirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

interface WorkerInput {
  nodes: Array<{ key: string; x?: number | null; y?: number | null }>;
  edges: Array<{ source: string; target: string; score: number }>;
}

interface WorkerOutput {
  type: "progress" | "done";
  positions: Array<{ key: string; x: number; y: number }>;
  iteration?: number;
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { nodes, edges } = e.data;

  // 建图
  const graph = new UndirectedGraph();
  for (const node of nodes) {
    graph.addNode(node.key, {
      x: node.x ?? Math.random() * 100 - 50,
      y: node.y ?? Math.random() * 100 - 50,
    });
  }
  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.addEdge(edge.source, edge.target, { weight: edge.score });
    }
  }

  // 用 graphology-layout-forceatlas2 的标准设置
  const settings = forceAtlas2.inferSettings(graph);
  const iterations = 200; // 足够 1000 节点收敛

  // 每 50 轮报告进度
  const positions: Array<{ key: string; x: number; y: number }> = [];

  let iter = 0;
  while (iter < iterations) {
    const batch = Math.min(50, iterations - iter);
    forceAtlas2.assign(graph, { settings, iterations: batch });

    // 收集当前坐标
    positions.length = 0;
    graph.forEachNode((key, attrs) => {
      positions.push({ key, x: attrs.x, y: attrs.y });
    });

    const output: WorkerOutput = {
      type: iter + batch >= iterations ? "done" : "progress",
      positions: [...positions],
      iteration: iter + batch,
    };
    self.postMessage(output);

    iter += batch;
  }

  self.close();
};
