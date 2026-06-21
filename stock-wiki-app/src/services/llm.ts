import { invoke } from "@tauri-apps/api/core";

// ── Types ───────────────────────────────────────────────────────

export type WikiType = "股票" | "概念" | "模式";

export interface LlmConfig {
  base_url: string | null;
  api_key: string | null;
}

export interface PreAnalysisEntity {
  type: WikiType;
  title: string;
  code?: string;
  industry?: string;
  concepts?: string[];
  action: "create" | "update";
  existing_path?: string;
}

// ── JSON Schema for pre-analysis ────────────────────────────────

const PRE_ANALYSIS_SCHEMA = {
  name: "pre_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["股票", "概念", "模式"],
            },
            title: { type: "string" },
            code: { type: "string" },
            industry: { type: "string" },
            concepts: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["type", "title"],
          additionalProperties: false,
        },
      },
    },
    required: ["entities"],
    additionalProperties: false,
  },
};

// ── Pre-analysis prompt ─────────────────────────────────────────

const PRE_ANALYSIS_PROMPT = `你是一个金融研究分析助手。分析以下文本，识别其中提到的所有实体（股票、概念、模式）。

对于每个实体，提取以下信息：

**股票 (type: "股票")：**
- title: 公司名称
- code: 股票代码（如 "300667"），如果提到的话
- industry: 所属行业
- concepts: 相关概念列表（尽量多提取）

**概念 (type: "概念")：**
- title: 概念名称（如 "口腔医疗器械"、"集采政策"）
- 无需 code/industry/concepts 字段

**模式 (type: "模式")：**
- title: 模式名称（如 K线形态、市场规律等）
- 无需 code/industry/concepts 字段

注意：
- 一只股票可能关联多个概念，每个概念单独列为一个实体
- 概念是和股票有关联性的主题/板块/政策等
- title 必须精确、唯一
- 不要编造信息，只提取文本中明确提到的内容

请以严格的 JSON 格式返回结果。`;

// ── Wiki generation prompts ─────────────────────────────────────

function buildWikiGenerationPrompt(
  entity: PreAnalysisEntity,
  sourceText: string,
  existingContent?: string,
): { system: string; user: string } {
  const typeLabel = entity.type;
  const hasExisting = !!existingContent;

  const stockFields =
    entity.type === "股票"
      ? `code: "${entity.code || ""}"
industry: "${entity.industry || ""}"
concepts: ${JSON.stringify(entity.concepts || [])}`
      : "";

  const system = `你是一个专业的金融研究 Wiki 编辑。你的任务是为一个研究知识库生成高质量的 Wiki 页面。

Wiki 页面使用 YAML frontmatter + 自由 Markdown 正文的格式。

输出格式要求：
\`\`\`
---
title: ${entity.title}
type: ${entity.type}
summary: <50-120字的概述，用作检索召回，提取最核心的信息>
created: <首次创建日期，ISO 格式 YYYY-MM-DD>
updated: <最后更新日期，ISO 格式 YYYY-MM-DD>
resource:
  - <来源引用>
${stockFields ? `${stockFields}` : ""}
---

# <标题>

<自由格式的 Markdown 正文，自行组织内容结构>
\`\`\`

注意事项：
1. summary 字段必须精炼（50-120字），因为只用于检索召回
2. 正文部分自由组织，不需要特定的章节结构
3. 使用 Markdown 表格、列表、代码块等适当格式化
4. 不要编造信息，只基于提供的源数据`;

  const user = hasExisting
    ? `以下是现有的 Wiki 页面内容，请根据新的源数据对其进行智能更新和合并，保留用户可能已经编辑过的内容：\n\n## 现有 Wiki\n${existingContent}\n\n## 新源数据\n${sourceText}`
    : `根据以下源数据生成 Wiki 页面：\n\n${sourceText}`;

  return { system, user };
}

// ── API call ────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

async function llmChat(
  messages: ChatMessage[],
  responseFormat?: { type: string; json_schema?: unknown },
): Promise<string> {
  const config: LlmConfig = await invoke("get_llm_config");

  const baseUrl = config.base_url || "https://api.deepseek.com";
  const apiKey = config.api_key;

  if (!apiKey) {
    throw new Error(
      "API Key 未配置。请在设置页面配置 LLM API Key。",
    );
  }

  const endpoint = baseUrl.replace(/\/+$/, "") + "/v1/chat/completions";

  const body: Record<string, unknown> = {
    model: "deepseek-chat",
    messages,
    temperature: 0.3,
    max_tokens: 4096,
  };

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  // Timeout after 120 seconds
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM API 错误 (${res.status}): ${errText}`);
    }

    const data: ChatCompletionResponse = await res.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("LLM 返回了空内容");
    }

    return content;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("LLM API 请求超时（120 秒）");
    }
    throw err;
  }
}

// ── Validation ──────────────────────────────────────────────────

const VALID_TYPES: WikiType[] = ["股票", "概念", "模式"];

export function validatePreAnalysis(raw: unknown): PreAnalysisEntity[] {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("预分析结果不是有效的 JSON 对象");
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.entities)) {
    throw new Error("预分析结果缺少 entities 数组");
  }

  const entities: PreAnalysisEntity[] = [];

  for (let i = 0; i < obj.entities.length; i++) {
    const item = obj.entities[i];

    if (typeof item !== "object" || item === null) {
      throw new Error(`实体 #${i + 1} 不是有效对象`);
    }

    const e = item as Record<string, unknown>;

    // Required fields
    if (typeof e.type !== "string" || !VALID_TYPES.includes(e.type as WikiType)) {
      throw new Error(
        `实体 #${i + 1} 的 type 字段无效: "${String(e.type)}"，必须是 "股票"、"概念" 或 "模式"`,
      );
    }

    if (typeof e.title !== "string" || !e.title.trim()) {
      throw new Error(`实体 #${i + 1} 缺少 title 字段`);
    }

    const entity: PreAnalysisEntity = {
      type: e.type as WikiType,
      title: e.title.trim(),
      action: "create", // Will be set by caller after checking existence
    };

    // Optional stock-specific fields
    if (e.type === "股票") {
      if (typeof e.code === "string" && e.code.trim()) {
        entity.code = e.code.trim();
      }
      if (typeof e.industry === "string" && e.industry.trim()) {
        entity.industry = e.industry.trim();
      }
      if (Array.isArray(e.concepts)) {
        entity.concepts = e.concepts
          .filter((c): c is string => typeof c === "string")
          .map((c) => c.trim())
          .filter(Boolean);
      }
    }

    entities.push(entity);
  }

  if (entities.length === 0) {
    throw new Error("预分析没有识别到任何实体");
  }

  return entities;
}

// ── Public API ──────────────────────────────────────────────────

export async function runPreAnalysis(
  extractedText: string,
): Promise<PreAnalysisEntity[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: PRE_ANALYSIS_PROMPT },
    { role: "user", content: extractedText },
  ];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let prompt = messages[0].content;
      if (attempt > 0 && lastError) {
        // Append validation error feedback
        prompt += `\n\n[上次输出的错误：${lastError.message}。请确保输出严格符合 JSON Schema。]`;
        messages[0] = { role: "system", content: prompt };
      }

      const raw = await llmChat(messages, {
        type: "json_schema",
        json_schema: PRE_ANALYSIS_SCHEMA,
      });

      const parsed = JSON.parse(raw);
      const entities = validatePreAnalysis(parsed);
      return entities;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // If it's a config error (e.g. no API key), don't retry
      if (lastError.message.includes("API Key")) {
        throw lastError;
      }
    }
  }

  throw new Error(
    `预分析在 3 次重试后仍然失败：${lastError?.message}`,
  );
}

export async function generateWiki(
  entity: PreAnalysisEntity,
  sourceText: string,
  existingContent?: string,
): Promise<string> {
  const { system, user } = buildWikiGenerationPrompt(
    entity,
    sourceText,
    existingContent,
  );

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  return llmChat(messages);
}

export async function getLlmConfig(): Promise<LlmConfig> {
  return invoke("get_llm_config");
}

export async function saveLlmConfig(
  baseUrl: string | null,
  apiKey: string | null,
): Promise<void> {
  return invoke("set_llm_config", {
    baseUrl: baseUrl || null,
    apiKey: apiKey || null,
  });
}
