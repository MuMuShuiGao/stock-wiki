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

  // ForceAtlas2 布局：加大间距避免节点挤在一起
  const settings = {
    ...forceAtlas2.inferSettings(graph),
    scalingRatio: 20,     // 默认 ~3，加大扩散空间
    gravity: 0.3,         // 降低中心引力，让节点自然散开
    strongGravityMode: true,
    outboundAttractionDistribution: true,  // hub 节点不被邻居挤扁
    linLogMode: true,     // 适合有社区结构的图
    edgeWeightInfluence: 0.8,
  };
  const iterations = 300;

  // 每 50 轮报告进度
  const positions: Array<{ key: string; x: number; y: number }> = [];

  let iter = 0;
  while (iter < iterations) {
    const batch = Math.min(50, iterations - iter);
    forceAtlas2.assign(graph, { settings, iterations: batch });

    // 收集当前坐标
    positions.length = 0;
    graph.forEachNode((key, { x, y }) => {
      positions.push({ key, x, y });
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
