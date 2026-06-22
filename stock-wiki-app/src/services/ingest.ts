import { invoke } from "@tauri-apps/api/core";
import { llmChat, extractJsonFromText, type WikiType } from "./llm";
import { logInfo, logWarn, logError } from "./logger";

// ── 类型定义 ──────────────────────────────────────────────────────

/** 单个变更计划条目 */
export interface PlannedPage {
  type: WikiType;
  title: string;
  aliases?: string[];
  code?: string;
  industry?: string;
  concepts?: string[];
  parent?: string;
  catalysts?: string[];
  action: "create" | "update";
  existing_path?: string;   // 由 normalizePlan() 设置
  rationale?: string;        // 变更理由
}

/** 完整的变更计划 */
export interface IngestPlan {
  create: PlannedPage[];
  update: PlannedPage[];
  analysisSummary?: string;   // 由调用方通过 extractAnalysisSummary() 设置
}

/** 管道阶段 */
export type PipelineStage =
  | "idle"
  | "extracting"
  | "analyzing"             // Stage 1
  | "planning"              // Stage 2
  | "awaiting_confirmation"
  | "updating"              // Stage 3
  | "creating"              // Stage 4
  | "housekeeping"
  | "done"
  | "error";

/** 阶段进度 */
export interface StageProgress {
  total: number;
  completed: number;
  failed: number;
  currentTitle: string | null;
  errors: Array<{ title: string; error: string }>;
}

/** 管道运行状态 */
export interface PipelineState {
  status: PipelineStage;
  sourceFilePath: string | null;
  extractedText: string;
  indexContent: string;       // wiki/index.md 的文本内容
  analysisText: string;       // Stage 1 输出
  plan: IngestPlan | null;    // Stage 2 输出（normalize 后）
  updateProgress: StageProgress;
  createProgress: StageProgress;
  error: string | null;
}

/** 初始管道状态 */
export function initialPipelineState(): PipelineState {
  return {
    status: "idle",
    sourceFilePath: null,
    extractedText: "",
    indexContent: "",
    analysisText: "",
    plan: null,
    updateProgress: { total: 0, completed: 0, failed: 0, currentTitle: null, errors: [] },
    createProgress: { total: 0, completed: 0, failed: 0, currentTitle: null, errors: [] },
    error: null,
  };
}

// ── 辅助函数 ──────────────────────────────────────────────────────

/** 从 index.md 文本中解析已有页面的 type/title 集合 */
function parseIndexTitles(indexContent: string): Set<string> {
  const titles = new Set<string>();
  // 匹配 [[type/title]] 或 [[type/title|alias]]
  const re = /\[\[([^\]/|]+)\/([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(indexContent)) !== null) {
    titles.add(`${match[1]}/${match[2]}`);
  }
  return titles;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 格式化时间戳 YYYY-MM-DD HH:mm:ss */
function formatTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 格式化日期 YYYY-MM-DD */
function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** parseAndWriteFileBlocks 的返回结果 */
interface WriteBlocksResult {
  /** 成功写入的页面数 */
  written: number;
  /** 成功写入的页面键集合（格式 "type/title"），用于跳过重试 */
  writtenKeys: Set<string>;
}

// ── JSON frontmatter ──────────────────────────────────────────────

// ── 分块解析 & 写入 ──────────────────────────────────────────────

/** 校验正文是否符合 Markdown 格式规范（至少以 # 标题开头） */
function validateBodyFormat(body: string, wikiType: string, title: string): void {
  if (!body) {
    throw new Error(`[${wikiType} / ${title}] 正文为空`);
  }
  const firstLine = body.split("\n")[0].trim();
  if (!firstLine.startsWith("# ")) {
    throw new Error(
      `[${wikiType} / ${title}] 正文第一行必须是 "# {title}"（一级标题），实际为: "${firstLine.substring(0, 60)}"`,
    );
  }
}

/** 解析 LLM 输出的 ENDFILE 分块并写入 wiki 页面。格式错误直接抛错，不兜底。 */
async function parseAndWriteFileBlocks(
  rawOutput: string,
  projectName: string,
): Promise<WriteBlocksResult> {
  const chunks = rawOutput
    .split(/^ENDFILE\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);

  logInfo("ingest", `解析 LLM 输出: ${chunks.length} 个分块`);

  let written = 0;
  const writtenKeys = new Set<string>();
  const errors: string[] = [];

  for (const chunk of chunks) {
    const newlineIdx = chunk.indexOf("\n");
    const headerLine = (newlineIdx === -1 ? chunk : chunk.substring(0, newlineIdx)).trim();
    const raw = (newlineIdx === -1 ? "" : chunk.substring(newlineIdx + 1)).trim();

    const path = headerLine.replace(/^---FILE:\s*/, "").replace(/---\s*$/, "").trim();
    const headerMatch = path.match(/^wiki\/([^/]+)\/(.+)\.md$/);
    if (!headerMatch) {
      logWarn("ingest", `跳过无法解析的块: "${headerLine.substring(0, 80)}"`);
      continue;
    }

    const wikiType = headerMatch[1];
    const title = headerMatch[2];

    try {
      // ── 严格校验：必须有 ====BODY==== 分隔符 ──
      const bodyMarker = "\n====BODY====\n";
      const bodyIdx = raw.indexOf(bodyMarker);
      if (bodyIdx === -1) {
        throw new Error(`缺少 ====BODY==== 分隔符`);
      }

      // ── 严格校验：JSON 必须是裸对象，不允许 ---json/--- 包裹 ──
      let jsonStr = raw.substring(0, bodyIdx).trim();
      if (jsonStr.startsWith("---")) {
        throw new Error(
          `JSON 部分被 frontmatter 分隔符包裹（以 "---" 开头）。请直接输出裸 JSON 对象。`,
        );
      }
      if (jsonStr.startsWith("```")) {
        throw new Error(
          `JSON 部分被代码块包裹（以 "\`\`\`" 开头）。请直接输出裸 JSON 对象。`,
        );
      }

      // ── 解析 JSON ──
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(jsonStr);
      } catch (e) {
        throw new Error(`JSON 解析失败: ${String(e)}`);
      }

      // ── 提取正文并校验 ──
      const body = raw.substring(bodyIdx + bodyMarker.length).trim();
      validateBodyFormat(body, wikiType, title);

      // ── 拼装 → 写入（字段排序由 Rust 后端 normalize_frontmatter 统一处理）──
      const content = `---json\n${JSON.stringify(json, null, 2)}\n---\n\n${body}`;

      logInfo("ingest", `写入 Wiki: ${wikiType}/${title} (${content.length} 字符)`);
      await invoke("write_wiki", {
        projectName,
        wikiType,
        title,
        content,
      });
      writtenKeys.add(`${wikiType}/${title}`);
      written++;
      logInfo("ingest", `写入成功: ${wikiType}/${title}`);
    } catch (e) {
      const msg = `${wikiType}/${title}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      logError("ingest", `格式校验失败 — ${msg}`);
    }
  }

  logInfo("ingest", `分块写入完成: ${written}/${chunks.length}`);
  if (errors.length > 0) {
    throw new Error(
      `${errors.length} 个页面格式校验失败（共 ${chunks.length} 个分块）:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
  return { written, writtenKeys };
}

// ── Stage 1: 分析源文档 ───────────────────────────────────────────

const STAGE1_PROMPT = `你是一名金融研究分析师。请阅读以下源文档，参考已有 Wiki 索引，输出一份结构化的分析报告。

## 已有 Wiki 索引
{indexContent}

## 分析维度

### 1. 提到的实体
列出文档中出现的股票、概念、模式、市场环境。对每一项说明：
- 是否已在索引中存在？
- 文档提供了哪些新信息？
- 在文档中的分量（核心 / 边缘）

**区分规则：**
- **核心实体**：文档花了篇幅展开论述、提供了具体数据或分析。值得单独建页面。
- **边缘提及**：仅列举名字、一笔带过、用作反面案例而没有展开（如"一下CPU，一下MLCC"这种行文）。这类不需要单独建页面，在相关页面的正文中用一句话提及即可。
- **一个实体 = 一个页面**：不要把多个独立实体合并到一个页面（如 "CPU_MLCC_无玻步" 是错误的），每个概念/股票/模式各自独立。

### 2. 核心论点和数据
- 文档的主要结论是什么？
- 支撑结论的关键数据有哪些？数据是否充分？

### 3. 实体之间的关联
- 股票归属于哪些概念？
- 概念之间的层级关系？
- 事件或政策如何影响这些实体？

### 4. 与已有 Wiki 的关系
- 这份资料强化了哪些已有页面里的判断？
- 有没有推翻或修正已有页面的内容？
- 补充了哪些已有页面没覆盖到的信息？

### 5. 不一致与疑点
- 文档内部是否有自相矛盾的地方？
- 与已有 Wiki 内容是否存在直接冲突？
- 有哪些信息附带了明显的前提条件或限定？

### 6. 页面变更建议
对源文档提到或暗示的每一个实体、概念、模式、市场环境，逐条列出：
- 应该新建的页面及理由
- 应该更新的已有页面及要追加的内容

**注意：源文档里但凡出现过的实体，都必须出现在建议里，不要遗漏。如果源文档自身包含了明确的创建建议，直接照录，不要筛掉。**

## 页面类型说明

- **股票**：具体的上市公司，属性有代码、行业、归属概念
- **概念**：具体的、可投资的主题/板块/赛道，通常有清晰边界和成分股。如"先进封装""存储芯片""AI"是概念。**模糊的泛称不是概念**，如"新技术""科技股""大消费"不应创建概念页面。
- **模式**：反复出现的投资规律、炒作范式、分析框架、策略方法论。如"新技术题材炒作模式""龙头战法""题材轮动"是模式。**关键区分：概念是用来投的（买什么），模式是用来分析的（怎么看/怎么做）。**
- **市场环境**：牛市/熊市/震荡市等市场状态描述，属性有持续时长、量能特征等
- **总结**：跨实体的综合性判断、复盘、展望

### 概念 vs 模式 的判定方法
1. 问自己"这个能买吗？"——能买到具体股票/ETF 的就是概念；只是分析方法论的就是模式
2. 泛泛的上位词（如"新技术""热门赛道"）不应设为概念，应作为模式、或在已有概念的页面正文中用文字提及
3. 如果源文档在讲"怎么判断/怎么炒"而非"炒什么"，那是模式不是概念

输出用自然的中文段落，不要用 JSON。`;

export async function runStage1Analysis(
  sourceText: string,
  indexContent: string,
): Promise<string> {
  logInfo("Stage 1", `开始分析源文档: 文本长度=${sourceText.length} 索引长度=${indexContent.length}`);

  const prompt = STAGE1_PROMPT.replace(
    "{indexContent}",
    indexContent || "(暂无已有页面)",
  );

  const messages = [
    { role: "system" as const, content: prompt },
    { role: "user" as const, content: sourceText },
  ];

  const result = await llmChat(messages);
  logInfo("Stage 1", `分析完成, 返回长度=${result.length}`);
  return result;
}

// ── Stage 2: 规划变更 ─────────────────────────────────────────────

/** Stage 2 输出的 JSON Schema——单页面条目定义，create 和 update 共用 */
const STAGE2_PAGE_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    type: { type: "string" as const, enum: ["股票", "概念", "模式", "市场环境", "总结"] },
    title: { type: "string" as const },
    rationale: { type: "string" as const },
    aliases: { type: "array" as const, items: { type: "string" as const } },
    code: { type: "string" as const },
    industry: { type: "string" as const },
    concepts: { type: "array" as const, items: { type: "string" as const } },
    parent: { type: "string" as const },
    catalysts: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["type", "title", "rationale"],
  additionalProperties: false,
};

/** Stage 2 输出的 JSON Schema（供支持 response_format 的 provider 使用） */
const STAGE2_PLAN_SCHEMA = {
  name: "ingest_plan",
  strict: true,
  schema: {
    type: "object",
    properties: {
      create: { type: "array", items: STAGE2_PAGE_ITEM_SCHEMA },
      update: { type: "array", items: STAGE2_PAGE_ITEM_SCHEMA },
    },
    required: ["create", "update"],
    additionalProperties: false,
  },
};

const STAGE2_PROMPT = `你是一个 Wiki 维护助手。你的任务是基于下方的分析结果，输出一份精确的 JSON 变更计划。

## 已有 Wiki 索引
{indexContent}

## 源文件
本次分析的源文件是：{sourceFileName}

## 输出格式

{
  "create": [
    { "type": "股票", "title": "沃格光电", "rationale": "创建理由", ... }
  ],
  "update": [
    { "type": "概念", "title": "消费电子", "rationale": "更新理由", ... }
  ]
}

## Wiki 类型（type 字段）

| type | 目录 | 说明 |
|------|------|------|
| "股票" | wiki/股票/ | 具体的上市公司 |
| "概念" | wiki/概念/ | 具体的、可投资的主题/板块/赛道（如"先进封装""存储芯片"）。**模糊泛称（如"新技术""科技股"）不是概念**，应归入"模式" |
| "模式" | wiki/模式/ | 投资规律、炒作范式、分析框架（如"新技术题材炒作模式"）。**判断标准：这个是讲"怎么炒"还是"炒什么"——前者是模式，后者是概念** |
| "市场环境" | wiki/市场环境/ | 牛市、熊市、震荡市等 |
| "总结" | wiki/总结/ | 跨实体的综合判断、复盘 |

必须且只能使用上述 5 种 type，不得自行发明。

## 字段规则

- type, title: 必填
- rationale: 必填，一句话理由，用于指导下阶段的页面写作
- create 中的页面必须不在索引中；update 中的页面必须在索引中已存在
- 不得重复

各类型可选字段：
- 股票: code, industry, concepts, aliases
  - **code 必须仅含字母和/或数字，不得含特殊符号**（A 股 6 位数字如 "603773"、港股 1-5 位数字如 "00700"、美股 ticker 字母如 "AAPL"，可选 "SH"/"SZ"/"BJ" 前缀）。含特殊符号的（如 "581+8820"、空格、连字符）说明源文档没有明确代码，**不得创建 "股票" 类型页面**，改在对应概念页面的正文中用文字提及。
- 概念: parent, catalysts, aliases
- 模式: aliases
- 市场环境: aliases
- 总结: aliases

## 核心约束

### 不要遗漏
分析结果中标注了「建议新建」「建议更新」「可考虑新建」「应新建」「recommend creating」的章节，其中列出的每一个页面都必须纳入计划。即使是措辞为「可考虑」的条目也不能省略——视为权威引用，直接照录。不要自行筛选。

### 不要捆绑
**一个页面 = 一个实体。** 不得将多个独立实体合并到一个页面（如 "CPU_MLCC_无玻步" 是错误的）。CPU、MLCC、无玻步是三个独立概念，应分别建页面或分别判断是否需要建页面。

### 不要为边缘提及建页
源文档中仅列举名字、一笔带过、作为反面例子顺手提及而没有展开论述的实体（如"一下CPU，一下MLCC"这种行文），**不要创建独立页面**。它们的信息量不足以支撑一个 wiki 页面。

### 不要虚构
update 列表中只纳入分析结果明确提到已有页面，不要拿源文档未涉及的内容填充。

### 排除系统页面
index.md、overview.md、log.md 由系统自动维护，不要列入计划。

### 源文档记录
为本次分析的源文件创建一个"总结"类型的页面，标题使用源文件名（去掉扩展名），rationale 写"源文档分析记录"。如果索引中已有同名总结页则放入 update。

请以严格的 JSON 格式返回。`;

interface LlmPlanOutput {
  create: PlannedPage[];
  update: PlannedPage[];
}

/**
 * 将 LLM 的计划与 index.md 对账：
 * - LLM 说 create 但 index 里已有 → 升级为 update
 * - LLM 说 update 但 index 里没有 → 降级为 create
 * - 跨 create/update 去重
 */
function normalizePlan(
  llmPlan: LlmPlanOutput,
  indexContent: string,
): IngestPlan {
  const existingTitles = parseIndexTitles(indexContent);
  const create: PlannedPage[] = [];
  const update: PlannedPage[] = [];
  const seenTitles = new Set<string>();

  // 先处理 create 列表
  for (const entity of llmPlan.create) {
    const key = `${entity.type}/${entity.title}`;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    if (existingTitles.has(key)) {
      // 升级：LLM 说 create 但文件已存在 → 改为 update
      update.push({
        ...entity,
        action: "update",
        existing_path: undefined, // 后面由 store 补
      });
    } else {
      create.push({ ...entity, action: "create" });
    }
  }

  // 再处理 update 列表
  for (const entity of llmPlan.update) {
    const key = `${entity.type}/${entity.title}`;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    if (!existingTitles.has(key)) {
      // 降级：LLM 说 update 但文件不存在 → 改为 create
      create.push({ ...entity, action: "create", existing_path: undefined });
    } else {
      update.push({ ...entity, action: "update", existing_path: undefined });
    }
  }

  return { create, update };
}

/** 校验 LLM 输出的计划 JSON */
function validatePlanOutput(raw: unknown): LlmPlanOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("计划结果不是有效的 JSON 对象");
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.create)) {
    throw new Error("计划结果缺少 create 数组");
  }
  if (!Array.isArray(obj.update)) {
    throw new Error("计划结果缺少 update 数组");
  }

  const validTypes: WikiType[] = ["股票", "概念", "模式", "市场环境", "总结"];

  function validatePage(item: unknown, action: string, index: number): PlannedPage {
    if (typeof item !== "object" || item === null) {
      throw new Error(`${action} #${index + 1} 不是有效对象`);
    }
    const e = item as Record<string, unknown>;

    if (typeof e.type !== "string" || !validTypes.includes(e.type as WikiType)) {
      throw new Error(
        `${action} #${index + 1} 的 type 无效: "${String(e.type)}"`,
      );
    }
    if (typeof e.title !== "string" || !e.title.trim()) {
      throw new Error(`${action} #${index + 1} 缺少 title`);
    }

    const page: PlannedPage = {
      type: e.type as WikiType,
      title: e.title.trim(),
      action: action as "create" | "update",
      rationale: typeof e.rationale === "string" ? e.rationale.trim() : "",
    };

    // 可选通用字段
    if (Array.isArray(e.aliases)) {
      page.aliases = e.aliases
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.trim())
        .filter(Boolean);
    }

    // 股票专属字段
    if (e.type === "股票") {
      if (typeof e.code === "string" && e.code.trim()) {
        const rawCode = e.code.trim();
        // 必须为纯字母数字（支持 A 股 6 位 / 美股 ticker / 港股代码），不含 +、空格等特殊符号
        if (!/^[A-Za-z]?\d{1,6}$|^[A-Z]{1,5}$|^(SH|SZ|BJ)\d{6}$/.test(rawCode)) {
          throw new Error(
            `${action} #${index + 1} "${e.title}" 的 code "${rawCode}" 格式不合法（需为纯字母数字，不含特殊符号）`,
          );
        }
        page.code = rawCode;
      }
      if (typeof e.industry === "string" && e.industry.trim()) page.industry = e.industry.trim();
      if (Array.isArray(e.concepts)) {
        page.concepts = e.concepts
          .filter((c): c is string => typeof c === "string")
          .map((c) => c.trim())
          .filter(Boolean);
      }
    }

    // 概念专属字段
    if (e.type === "概念") {
      if (typeof e.parent === "string" && e.parent.trim()) page.parent = e.parent.trim();
      if (Array.isArray(e.catalysts)) {
        page.catalysts = e.catalysts
          .filter((c): c is string => typeof c === "string")
          .map((c) => c.trim())
          .filter(Boolean);
      }
    }

    return page;
  }

  const create = (obj.create as unknown[]).map((item, i) => validatePage(item, "create", i));
  const update = (obj.update as unknown[]).map((item, i) => validatePage(item, "update", i));

  if (create.length === 0 && update.length === 0) {
    throw new Error("计划为空：create 和 update 都为空");
  }

  return { create, update };
}

export async function runStage2Planning(
  analysisText: string,
  indexContent: string,
  sourceFileName?: string,
): Promise<IngestPlan> {
  logInfo("Stage 2", `开始规划变更: 来源=${sourceFileName || "未知"}`);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        logInfo("Stage 2", `第 ${attempt + 1} 次重试...`);
      }

      let prompt = STAGE2_PROMPT
        .replace("{indexContent}", indexContent || "(暂无已有页面)")
        .replace("{sourceFileName}", sourceFileName || "未知文件");

      if (attempt > 0 && lastError) {
        prompt += `\n\n[上次输出错误：${lastError.message}。请确保输出严格符合 JSON Schema。]`;
      }

      // responseFormat 由 llmChat 内部根据 provider 能力自动适配：
      // 支持的 provider (OpenAI) → 原生 structured output
      // 不支持的 (DeepSeek/Anthropic/custom) → 自动剥离，依赖 prompt 指令
      const raw = await llmChat(
        [
          { role: "system", content: prompt },
          { role: "user", content: analysisText },
        ],
        { type: "json_schema", json_schema: STAGE2_PLAN_SCHEMA },
      );

      logInfo("Stage 2", `LLM 返回, 长度=${raw.length}, 开始解析 JSON...`);

      // extractJsonFromText 对纯 JSON 幂等；对带 markdown 包裹的输出负责提取
      const jsonText = extractJsonFromText(raw);
      const parsed = JSON.parse(jsonText);
      const validated = validatePlanOutput(parsed);
      const plan = normalizePlan(validated, indexContent);

      logInfo("Stage 2", `规划完成: create=${plan.create.length} update=${plan.update.length}`);
      if (plan.create.length > 0) {
        logInfo("Stage 2", `新建: ${plan.create.map((p) => p.title).join(", ")}`);
      }
      if (plan.update.length > 0) {
        logInfo("Stage 2", `更新: ${plan.update.map((p) => p.title).join(", ")}`);
      }

      return plan;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logWarn("Stage 2", `第 ${attempt + 1} 次失败: ${lastError.message}`);
      if (lastError.message.includes("API Key")) throw lastError;
    }
  }

  logError("Stage 2", `3 次重试后仍然失败: ${lastError?.message}`);
  throw new Error(
    `变更规划在 3 次重试后仍然失败：${lastError?.message}`,
  );
}

// ── 共享：元数据字段说明（Stage 3 / Stage 4 共用）─────────

/** JSON frontmatter 字段说明（嵌入 LLM prompt），{TIMESTAMP_RULE} 由 buildFrontmatterPrompt() 替换 */
const FRONTMATTER_SCHEMA = `## 元数据字段说明

以下字段以 JSON 格式输出（作为每个页面块的第一部分），存储时直接作为 JSON frontmatter。

### 必填字段
- \`schema_version\`: 1
- \`title\` — 必须与文件名（不含 \`.md\`）匹配
- \`type\` — 以下之一：股票 / 概念 / 模式 / 市场环境 / 总结
- \`summary\` — 50–120 字概括，**严禁照搬正文段落**；便于检索召回
- \`created\`、\`updated\`、\`last_reviewed\` — 字符串格式 \`YYYY-MM-DD HH:mm:ss\`。{TIMESTAMP_RULE}

### 按类型必填字段
- type=股票: \`code\` 必须为纯字母数字（A 股如 \`"603773"\`、\`"SZ301580"\`；港股如 \`"00700"\`；美股如 \`"AAPL"\`）。含 \`+\`、空格、连字符等特殊符号的代号不合法，该页面不应以 "股票" 类型创建

### sources 字段（必填）
- \`sources\` — 源文件名字符串数组（不带 \`.md\` 后缀）。**新建时**：填入本次源文件名（如 \`["新技术炒作经验分享"]\`）。**更新时**：保留已有 \`sources\` 数组的所有旧值，追加本次源文件名（去重），形成累积列表（如 \`["新技术炒作经验分享", "半导体行业深度"]\`）

### 可选字段
- \`aliases\` — 字符串数组
- \`tags\` — 字符串数组
- \`related\` — wikilink 字符串数组，每项格式 \`[[type/name]]\`
- type=概念: \`parent\`、\`catalysts\`
- type=股票: \`industry\`、\`concepts\`

### 格式规则
- 所有字段值用 JSON 原生类型：字符串用 \`"...\`，数组用 \`[...]\`，数字不写引号
- 不得包含重复的字段名
- type 等有中文枚举值的字段，**必须输出中文值**，不得使用英文
- 时间字段格式必须为 \`YYYY-MM-DD HH:mm:ss\`（包含秒），仅 \`YYYY-MM-DD\` 为无效格式`;

/** 替换 FRONTMATTER_SCHEMA 中的 {TIMESTAMP_RULE} 占位符 */
function buildFrontmatterPrompt(nowStr: string, keepExistingTimestamps: boolean): string {
  const tsRule = keepExistingTimestamps
    ? `新字段使用 \`${nowStr}\`；created 字段必须从已有页面的 JSON frontmatter 中原样复制，绝对不可修改；updated 和 last_reviewed 使用当前时间`
    : `所有时间字段均使用 \`${nowStr}\``;
  return FRONTMATTER_SCHEMA.replace("{TIMESTAMP_RULE}", tsRule);
}

/** pagesToJson 输出的条目类型（含可选 existingContent，非 PlannedPage 自有字段） */
interface PromptPageEntry {
  type: WikiType;
  title: string;
  rationale: string;
  existingContent?: string;
  code?: string;
  industry?: string;
  concepts?: string[];
  parent?: string;
  catalysts?: string[];
  aliases?: string[];
}

/** 将 PlannedPage[] 转为 JSON（给 LLM prompt 用） */
function pagesToJson(
  pages: PlannedPage[],
  existingContents?: Record<string, string>,
): string {
  return JSON.stringify(
    pages.map((p): PromptPageEntry => {
      const entry: PromptPageEntry = {
        type: p.type,
        title: p.title,
        rationale: p.rationale || "",
      };
      if (existingContents) {
        const key = `${p.type}/${p.title}`;
        entry.existingContent =
          (existingContents[key] || "").substring(0, 3000) || "(无已有内容)";
      }
      if (p.code) entry.code = p.code;
      if (p.industry) entry.industry = p.industry;
      if (p.concepts?.length) entry.concepts = p.concepts;
      if (p.parent) entry.parent = p.parent;
      if (p.catalysts?.length) entry.catalysts = p.catalysts;
      if (p.aliases?.length) entry.aliases = p.aliases;
      return entry;
    }),
    null,
    2,
  );
}

// ── Stage 3 / Stage 4 共享：提示词块 ───────────────────────────────

/** 输出格式说明（Stage 3/4 共用） */
const OUTPUT_FORMAT_BLOCK = `## 输出格式
每个页面分为两部分输出：**元数据 JSON** + 独占一行的 \`====BODY====\` + **正文 Markdown**。
用 "---FILE: wiki/{type}/{title}.md---" 开头，用独占一行的 "ENDFILE" 结尾。

**关键约束：**
- JSON 部分**直接输出裸 JSON 对象**，不要包裹在 \`\`\`json\`\`\`、\`---json\`/\`---\`、或 \`---\`/\`---\` 当中
- \`====BODY====\` 必须独占一行，前后各有一个空行（即 \`\\n\\n====BODY====\\n\\n\`）
- 如果缺少 \`====BODY====\` 分隔符，格式校验将报错，该页及同批所有页面均不会写入`;

/** JSON 字段使用说明（Stage 3/4 共用，不含时间戳保留提示） */
const JSON_FIELD_NOTES = `## JSON 字段说明
- 与上述字段说明中列出的字段完全一致，只是用 JSON 格式表达
- 列表字段（tags / related / sources / aliases / concepts / catalysts）使用 JSON 数组
- 字符串值不要有多余的引号或转义（JSON 解析器会自动处理）`;

/** 正文 Markdown 格式规范（Stage 3/4 共用） */
const BODY_FORMAT_BLOCK = `## 正文格式规范
- **正文第一行必须是 \`# {title}\`（一级标题），不可省略、不可写成裸文本**
- 章节标题（##）上下各空一行，三级标题（###）上方空一行、下方不空行
- 段落之间空一行，段落内部不空行、不换行（一段写成连续文字）
- 不得出现连续两行以上的空行
- **禁止使用任何列表前缀**（\`- \`、\`* \`、\`+ \`、\`1. \` 等）。所有并列陈述必须写成独立段落，用 **加粗标题**：内容的格式承接上文
- 行首不得有空格或缩进（Markdown 正文顶格写），每行第一个字符必须从第 1 列开始
- 正文中如引用 wikilink，格式为 \`[[type/title]]\`，不带引号`;

// ── Stage 3 / Stage 4 共享：批量写入 ───────────────────────────────

const STAGE3_UPDATE_PROMPT = `你是一个 Wiki 维护助手。你的任务是更新已有的 Wiki 页面，融入来自新资料的信息。

{FRONTMATTER_SCHEMA}

## 更新专属规则
1. **必须保留所有已有内容** — 不要删除任何现有段落、数据、分析
2. **只能追加和细化** — 新信息作为新段落或子章节添加，或作为对现有段落的补充
3. **保持格式一致** — 沿用已有页面的 Markdown 结构风格
4. **去重** — 如果新信息与已有内容重复，跳过（不要写入重复信息）

## 源文档
源文件名（用于写入 sources 字段）：{sourceFileName}

## 源文档分析结果
{analysisText}

## 要更新的页面 (JSON)
{pagesJson}

${OUTPUT_FORMAT_BLOCK}

## 输出示例
---FILE: wiki/概念/消费电子.md---
{
  "schema_version": 1,
  "title": "消费电子",
  "type": "概念",
  "summary": "消费电子行业包括智能手机、PC、可穿戴设备等终端产品的产业链。",
  "created": "2025-12-01 09:00:00",
  "updated": "{nowStr}",
  "last_reviewed": "{nowStr}",
  "parent": "制造业",
  "catalysts": ["新品发布季", "换机潮"],
  "sources": ["{sourceFileName}"]
}

====BODY====

# 消费电子

## 概述
消费电子是指...（保留的已有内容）

## 最新动态
（追加的新信息段落）
ENDFILE

${JSON_FIELD_NOTES}
- **created 字段**：从已有页面的 JSON frontmatter 中读取原值，原样输出，**绝对不要修改**（页面创建时间不可变）
- 其余已有字段（如 updated、last_reviewed）更新为当前时间
- **sources 字段必须累积合并**：从已有页面的 JSON frontmatter 中读取已有 sources 数组，所有旧值全部保留，末尾追加本次源文件名（去重），不要用新值覆盖

${BODY_FORMAT_BLOCK}`;

const STAGE4_CREATE_PROMPT = `你是一个 Wiki 创建助手。根据分析结果，同时生成以下新页面。

{FRONTMATTER_SCHEMA}

## 源文档
源文件名（用于写入 sources 字段）：{sourceFileName}

## 分析结果
{analysisText}

## 要创建的页面列表 (JSON)
{pagesJson}

${OUTPUT_FORMAT_BLOCK}

## 输出示例
---FILE: wiki/股票/沃格光电.md---
{
  "schema_version": 1,
  "title": "沃格光电",
  "type": "股票",
  "summary": "沃格光电主营玻璃基板业务，是显示面板上游关键材料供应商。",
  "created": "{nowStr}",
  "updated": "{nowStr}",
  "last_reviewed": "{nowStr}",
  "code": "603773",
  "industry": "电子元器件",
  "concepts": ["消费电子", "玻璃基板"],
  "aliases": ["沃格"],
  "tags": ["面板"],
  "related": ["[[概念/消费电子]]", "[[概念/玻璃基板]]"],
  "sources": ["{sourceFileName}"]
}

====BODY====

# 沃格光电

## 概述
沃格光电（603773）是国内玻璃基板龙头企业...
ENDFILE

${JSON_FIELD_NOTES}

${BODY_FORMAT_BLOCK}`;

/** 批量写入的返回结果 */
export interface BatchWriteResult {
  writtenKeys: Set<string>;
  allWritten: boolean;
}

interface BatchWriteOptions {
  stage: string;                       // 日志标签，如 "Stage 3" / "Stage 4"
  pages: PlannedPage[];
  promptTemplate: string;
  keepExistingTimestamps: boolean;
  userMessage: string;
  analysisText: string;
  sourceFileName: string;              // 源文件名（不含路径），直接写入 sources 字段
  projectName: string;
  existingContents?: Record<string, string>;  // update 时需要
}

async function batchWritePages(opts: BatchWriteOptions): Promise<BatchWriteResult> {
  const { stage, pages, promptTemplate, keepExistingTimestamps, userMessage, analysisText, sourceFileName, projectName, existingContents } = opts;

  logInfo(stage, `批量写入: ${pages.length} 页: ${pages.map((p) => p.title).join(", ")}`);

  const nowStr = formatTimestamp(new Date());
  const basePrompt = promptTemplate
    .replace("{FRONTMATTER_SCHEMA}", buildFrontmatterPrompt(nowStr, keepExistingTimestamps))
    .replace("{analysisText}", analysisText.substring(0, 4000))
    .replace("{pagesJson}", pagesToJson(pages, existingContents))
    .replace("{sourceFileName}", sourceFileName)
    .replace(/\{nowStr\}/g, nowStr);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) {
        logInfo(stage, `重试...`);
      }

      const prompt = attempt > 0 && lastError
        ? `${basePrompt}\n\n[上一轮输出格式校验失败，请严格按格式要求重新输出。错误详情：${lastError.message}]`
        : basePrompt;

      const rawOutput = await llmChat([
        { role: "system" as const, content: prompt },
        { role: "user" as const, content: userMessage },
      ]);
      logInfo(stage, `LLM 返回: ${rawOutput.length} 字符`);

      const { written, writtenKeys } = await parseAndWriteFileBlocks(rawOutput, projectName);

      const allWritten = written >= pages.length;
      if (!allWritten) {
        logWarn(stage, `期望写入 ${pages.length} 页，实际写入 ${written} 页`);
      } else {
        logInfo(stage, `全部完成: ${written} 页`);
      }

      return { writtenKeys, allWritten };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logWarn(stage, `失败: ${lastError.message}`);
    }
  }

  throw new Error(
    `${stage} 重试后仍然失败：${lastError?.message}`,
  );
}

export async function batchUpdateWikiPages(
  pages: PlannedPage[],
  existingContents: Record<string, string>,
  analysisText: string,
  sourceFileName: string,
  projectName: string,
): Promise<BatchWriteResult> {
  return batchWritePages({
    stage: "Stage 3",
    pages,
    promptTemplate: STAGE3_UPDATE_PROMPT,
    keepExistingTimestamps: true,
    userMessage: "请更新以上所有 Wiki 页面。",
    analysisText,
    sourceFileName,
    projectName,
    existingContents,
  });
}

export async function batchCreateWikiPages(
  pages: PlannedPage[],
  analysisText: string,
  sourceFileName: string,
  projectName: string,
): Promise<BatchWriteResult> {
  return batchWritePages({
    stage: "Stage 4",
    pages,
    promptTemplate: STAGE4_CREATE_PROMPT,
    keepExistingTimestamps: false,
    userMessage: "请生成以上所有新页面。",
    analysisText,
    sourceFileName,
    projectName,
  });
}

// ── Housekeeping ───────────────────────────────────────────────────

/** 追加写入每日分片日志 wiki/logs/log-YYYY-MM-DD.md */
export async function writeLogMd(
  projectName: string,
  sourceFileName: string,
  plan: IngestPlan,
): Promise<void> {
  logInfo("Housekeeping", `写入操作日志: ${sourceFileName}`);

  const now = new Date();
  const today = formatDate(now);

  const createList = plan.create.map((p) => `- wiki/${p.type}/${p.title}.md`).join("\n");
  const updateList = plan.update.map((p) => `- wiki/${p.type}/${p.title}.md`).join("\n");
  const totalCount = plan.create.length + plan.update.length;

  let pagesBlock = "";
  if (plan.create.length > 0) {
    pagesBlock += `create ${plan.create.length}\n${createList}`;
  }
  if (plan.update.length > 0) {
    if (pagesBlock) pagesBlock += "\n";
    pagesBlock += `update ${plan.update.length}\n${updateList}`;
  }

  const entry = [
    `## [${today}] ingest | ${sourceFileName}`,
    pagesBlock,
    `Pages written/updated: ${totalCount}`,
    "",
  ].join("\n");

  const ws: string | null = await invoke("get_workspace");
  if (!ws) {
    logWarn("Housekeeping", "工作区未配置，跳过日志写入");
    return;
  }
  const logPath = `${ws}\\${projectName}\\wiki\\logs\\log-${today}.md`;

  // 读取已有日志，确保以 # Wiki Log {date} 开头
  let existing = "";
  try {
    existing = await invoke("read_file", { filePath: logPath });
  } catch {
    // 当天文件还不存在，写入标题行
    existing = `# Wiki Log ${today}\n\n`;
  }
  // 追加到文件尾部（新记录在最后）
  await invoke("write_file", { filePath: logPath, content: existing + entry });
  logInfo("Housekeeping", `操作日志已写入: ${logPath}`);
}

/** 从 wiki 页面内容中提取 frontmatter 的 summary 字段（---json 格式） */
export function extractSummaryFromFrontmatter(content: string): string {
  if (content.startsWith("---json")) {
    const endIdx = content.indexOf("\n---", 7);
    if (endIdx === -1) return "";
    const jsonStr = content.substring(7, endIdx).trim();
    try {
      const data = JSON.parse(jsonStr);
      return typeof data.summary === "string" ? data.summary : "";
    } catch {
      return "";
    }
  }
  return "";
}

/** 向 wiki/index.md 追加一条条目 */
export async function appendWikiIndex(
  projectName: string,
  wikiType: string,
  title: string,
  summary: string,
): Promise<void> {
  logInfo("Housekeeping", `追加索引: ${wikiType}/${title} summary=${summary.substring(0, 50)}`);
  await invoke("append_wiki_index", { projectName, wikiType, title, summary });
}

/** 从分析文本提取简短的摘要（取前几个关键句） */
export function extractAnalysisSummary(analysisText: string): string {
  if (!analysisText) return "(无分析文本)";
  // 取第一段作摘要，限制 200 字
  const firstParagraph = analysisText.split("\n\n")[0] || "";
  const cleaned = firstParagraph.replace(/^#+\s*/gm, "").trim();
  if (!cleaned) return "(无分析文本)";
  return cleaned.length > 200 ? cleaned.substring(0, 200) + "..." : cleaned;
}
