import { invoke } from "@tauri-apps/api/core";
import { logInfo, logError, logWarn } from "./logger";

// ── 类型 ──────────────────────────────────────────────────────────

/** Wiki 页面类型 */
export type WikiType = "股票" | "概念" | "模式" | "市场环境" | "总结";

/** 支持的 LLM 提供商 */
export type LlmProvider = "deepseek" | "openai" | "anthropic" | "custom";

/** LLM API 连接配置 */
export interface LlmConfig {
  base_url: string | null;
  api_key: string | null;
  provider: LlmProvider;
  model?: string | null;
}

// ── Provider 能力 ─────────────────────────────────────────────────

/**
 * 各 provider 的能力声明。
 * 新增 provider 时在这里登记即可，调用方无需感知差异。
 */
const PROVIDER_CAPABILITIES: Record<LlmProvider, {
  supportsResponseFormat: boolean;
  defaultModel: string;
  defaultBaseUrl: string;
}> = {
  deepseek: {
    supportsResponseFormat: false,
    defaultModel: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com",
  },
  openai: {
    supportsResponseFormat: true,
    defaultModel: "gpt-4o",
    defaultBaseUrl: "https://api.openai.com",
  },
  anthropic: {
    supportsResponseFormat: false,
    defaultModel: "claude-sonnet-4-6",
    defaultBaseUrl: "https://api.anthropic.com",
  },
  custom: {
    supportsResponseFormat: false,
    defaultModel: "",
    defaultBaseUrl: "",
  },
};

/** 根据 base_url 自动推断 provider */
export function detectProvider(baseUrl: string | null): LlmProvider {
  if (!baseUrl) return "custom";
  const url = baseUrl.toLowerCase();
  if (url.includes("deepseek")) return "deepseek";
  if (url.includes("openai")) return "openai";
  if (url.includes("anthropic")) return "anthropic";
  return "custom";
}

/** 检查 provider 是否原生支持 response_format 参数 */
function supportsResponseFormat(provider: LlmProvider): boolean {
  return PROVIDER_CAPABILITIES[provider]?.supportsResponseFormat ?? false;
}

/** 获取 provider 的默认 base_url */
export function getDefaultBaseUrl(provider: LlmProvider): string {
  return PROVIDER_CAPABILITIES[provider]?.defaultBaseUrl ?? "";
}

// ── JSON 提取工具 ─────────────────────────────────────────────────

/**
 * 从 LLM 原始输出中提取 JSON 文本。
 * 处理常见的包裹形式：```json ... ``` 代码块、前后缀说明文字。
 * 对已是纯 JSON 的文本幂等（直接返回）。
 */
export function extractJsonFromText(text: string): string {
  // 尝试匹配 ```json ... ``` 或 ``` ... ``` 代码块
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  // 尝试找到第一个 { 和最后一个 } 之间的内容（处理有前后缀的情况）
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.substring(firstBrace, lastBrace + 1).trim();
  }

  // 原样返回
  return text.trim();
}

// ── API 调用 ──────────────────────────────────────────────────────

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

/**
 * 调用 LLM Chat Completion API。
 *
 * @param messages       消息列表
 * @param responseFormat 可选的响应格式约束（JSON Schema 等）。
 *                       对不支持的 provider 会自动剥离并通过 prompt 降级。
 * @returns              LLM 返回的文本内容。
 *                       调用方如需解析 JSON，请额外使用 {@link extractJsonFromText}。
 */
export async function llmChat(
  messages: ChatMessage[],
  responseFormat?: { type: string; json_schema?: unknown },
): Promise<string> {
  const config: LlmConfig = await invoke("get_llm_config");

  const provider: LlmProvider = config.provider || detectProvider(config.base_url);
  const baseUrl = config.base_url || getDefaultBaseUrl(provider);
  if (!baseUrl) {
    throw new Error("未配置 API Base URL。请在设置中配置。");
  }
  const apiKey = config.api_key;

  if (!apiKey) {
    logError("LLM", "API Key 未配置");
    throw new Error("API Key 未配置。请在设置页面配置 LLM API Key。");
  }

  const endpoint = baseUrl.replace(/\/+$/, "") + "/v1/chat/completions";

  const model = config.model || PROVIDER_CAPABILITIES[provider]?.defaultModel;
  if (!model) {
    throw new Error(`未配置模型名称。请在设置中指定 provider 的 model。`);
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 4096,
  };

  // Provider 能力适配：response_format
  if (responseFormat) {
    if (supportsResponseFormat(provider)) {
      body.response_format = responseFormat;
    } else {
      logWarn(
        "LLM",
        `Provider "${provider}" 不支持 response_format，已剥离（依赖 prompt 中的 JSON 指令）`,
      );
      // 不设置 body.response_format，由调用方通过 extractJsonFromText 解析
    }
  }

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  logInfo(
    "LLM",
    `调用 API: ${endpoint} | provider=${provider} 消息数=${messages.length} 总字符=${totalChars} 有Schema=${!!responseFormat}`,
  );

  // 120 秒超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  const startTime = Date.now();

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

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!res.ok) {
      const errText = await res.text();
      logError("LLM", `API 错误 (${res.status}) 耗时=${elapsed}s: ${errText.substring(0, 500)}`);
      throw new Error(`LLM API 错误 (${res.status}): ${errText}`);
    }

    const data: ChatCompletionResponse = await res.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      logError("LLM", `返回空内容 耗时=${elapsed}s`);
      throw new Error("LLM 返回了空内容");
    }

    logInfo("LLM", `调用成功 耗时=${elapsed}s 返回长度=${content.length} 预览=${content.substring(0, 120)}...`);
    return content;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      logError("LLM", "请求超时（120 秒）");
      throw new Error("LLM API 请求超时（120 秒）");
    }
    if (!(err instanceof Error) || !err.message.startsWith("LLM")) {
      logError("LLM", `网络/未知错误: ${String(err)}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── 配置读写 ──────────────────────────────────────────────────────

/** 获取 LLM 配置 */
export async function getLlmConfig(): Promise<LlmConfig> {
  return invoke("get_llm_config");
}

/** 保存 LLM 配置 */
export async function saveLlmConfig(
  baseUrl: string | null,
  apiKey: string | null,
  provider?: LlmProvider | null,
  model?: string | null,
): Promise<void> {
  return invoke("set_llm_config", {
    baseUrl: baseUrl || null,
    apiKey: apiKey || null,
    provider: provider || null,
    model: model || null,
  });
}
