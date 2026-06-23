import { invoke } from "@tauri-apps/api/core";

// ── 类型定义 ──────────────────────────────────────────────────────

export interface WikilinksNode {
  key: string; // "股票/沃格光电"
  type: string; // "股票" | "概念" | "模式" | "市场环境" | "总结"
  title: string;
  summary: string;
  aliases: string[];
  degree: number;
  sources_count: number;
  x: number | null;
  y: number | null;
}

export interface WikilinksEdge {
  source: string; // "type/title"
  target: string; // "type/title"
  score: number;
  tier: string;
}

export interface WikilinksData {
  version: number;
  updated: string;
  nodes: Record<string, WikilinksNode>;
  edges: WikilinksEdge[];
}

// ── Rust 命令封装 ─────────────────────────────────────────────────

/** 调用 Rust 后端扫描 wiki 目录，全量重建 .wikilinks.json */
export async function rebuildWikilinks(projectName: string): Promise<void> {
  await invoke("rebuild_wikilinks", { projectName });
}

/** 读取项目下的 wiki/.wikilinks.json 并解析 */
export async function readWikilinks(
  workspace: string,
  projectName: string,
): Promise<WikilinksData> {
  const filePath = `${workspace}\\${projectName}\\wiki\\.wikilinks.json`;
  const raw: string = await invoke("read_file", { filePath });
  return JSON.parse(raw) as WikilinksData;
}
