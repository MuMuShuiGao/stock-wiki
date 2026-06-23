import { invoke } from "@tauri-apps/api/core";
import { llmChat } from "./llm";
import { logInfo, logError } from "./logger";

// ── Types ──────────────────────────────────────────────────────────

export interface SearchResult {
  path: string;
  title: string;
  wiki_type: string;
  score: number;
  content: string;
}

export interface ConversationMeta {
  id: string;
  title: string;
  created: string;
  updated: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  references: string[];
}

export interface Conversation {
  id: string;
  title: string;
  created: string;
  updated: string;
  messages: ChatMessage[];
}

// ── Context budget ─────────────────────────────────────────────────

/** 总上下文预算（字符数），60% 用于 wiki 页面 */
const MAX_CONTEXT_CHARS = 80000;
const PAGE_BUDGET = Math.floor(MAX_CONTEXT_CHARS * 0.6);
const MAX_PAGE_SIZE = Math.min(Math.floor(PAGE_BUDGET * 0.3), 30000);

// ── System prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一个股票投资研究助手。你的任务是基于提供的 Wiki 知识库页面回答用户问题。

规则：
- 仅基于下面提供的编号 Wiki 页面进行回答。
- 如果提供的页面信息不足，请诚实地说明。
- 引用来源时使用方括号中的页码，例如 [1]、[2]。
- 回答应简短、结构化、有依据，避免冗长叙述。
- 如果有多个页面涉及同一主题，请综合分析。`;

// ── Search ─────────────────────────────────────────────────────────

/** 调用 Rust search_wiki 检索相关页面 */
export async function searchWiki(projectName: string, query: string): Promise<SearchResult[]> {
  return invoke("search_wiki", { projectName, query });
}

// ── Context filling ────────────────────────────────────────────────

/**
 * 按优先级填充 wiki 页面到上下文预算中。
 * P0（标题命中）→ P1（内容命中）
 */
function fillContextBudget(results: SearchResult[]): SearchResult[] {
  const selected: SearchResult[] = [];
  let usedBudget = 0;

  const P0 = results.filter((r) => r.score >= 10); // 有 TITLE_BONUS 的
  const P1 = results.filter((r) => r.score < 10 && r.score > 0);

  // P0: 标题命中
  for (const r of P0) {
    const size = Math.min(r.content.length, MAX_PAGE_SIZE);
    if (usedBudget + size > PAGE_BUDGET) break;
    selected.push({ ...r, content: r.content.substring(0, MAX_PAGE_SIZE) });
    usedBudget += size;
  }

  // P1: 内容命中
  for (const r of P1) {
    const size = Math.min(r.content.length, MAX_PAGE_SIZE);
    if (usedBudget + size > PAGE_BUDGET) break;
    selected.push({ ...r, content: r.content.substring(0, MAX_PAGE_SIZE) });
    usedBudget += size;
  }

  return selected;
}

// ── LLM answer ─────────────────────────────────────────────────────

/** 构建 wiki 页面上下文文本（喂给 LLM 的格式） */
function buildPagesContext(pages: SearchResult[]): string {
  return pages
    .map((p, i) => {
      const pathInfo = p.path ? `\nPath: ${p.path}` : "";
      return `### [${i + 1}] ${p.title}${pathInfo}\n\n${p.content}`;
    })
    .join("\n\n---\n\n");
}

/** 生成回答并返回完整消息 */
export async function generateAnswer(
  projectName: string,
  query: string,
  chatHistory: ChatMessage[],
): Promise<ChatMessage> {
  // 1. 检索相关 wiki 页面
  let results: SearchResult[];
  try {
    results = await searchWiki(projectName, query);
    logInfo("chat", `检索到 ${results.length} 篇相关页面`);
  } catch (err) {
    logError("chat", `检索失败: ${err}`);
    throw err;
  }

  // 2. 按预算截断
  const selected = fillContextBudget(results);
  const pagesContext = buildPagesContext(selected);

  logInfo(
    "chat",
    `上下文: 选中 ${selected.length} 篇 (预算 ${PAGE_BUDGET} 字符，已用 ${pagesContext.length} 字符)`,
  );

  // 4. 构建消息列表
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // 加入最近 N 轮历史（最近 5 轮 = 10 条消息）
  const recentHistory = chatHistory.slice(-10);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // 当前问题 + wiki 上下文
  messages.push({
    role: "user",
    content: `以下是相关 Wiki 知识库页面内容：\n\n${pagesContext}\n\n---\n\n用户问题：${query}`,
  });

  // 5. 调用 LLM
  const answer = await llmChat(messages);

  // 6. 构建引用列表
  const references = selected.map((r) => r.path);

  return {
    role: "assistant",
    content: answer,
    references,
  };
}

// ── Conversation CRUD ──────────────────────────────────────────────

export async function listConversations(projectName: string): Promise<ConversationMeta[]> {
  return invoke("list_conversations", { projectName });
}

export async function createConversation(
  projectName: string,
  title: string,
): Promise<Conversation> {
  return invoke("create_conversation", { projectName, title });
}

export async function getConversation(
  projectName: string,
  convId: string,
): Promise<Conversation> {
  return invoke("get_conversation", { projectName, convId });
}

export async function saveConversation(
  projectName: string,
  convId: string,
  messages: ChatMessage[],
  newTitle?: string,
): Promise<void> {
  return invoke("save_conversation", {
    projectName,
    convId,
    messages,
    newTitle: newTitle || null,
  });
}

export async function deleteConversation(
  projectName: string,
  convId: string,
): Promise<void> {
  return invoke("delete_conversation", { projectName, convId });
}
