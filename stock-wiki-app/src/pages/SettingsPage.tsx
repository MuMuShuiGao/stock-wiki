import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import {
  saveLlmConfig,
  detectProvider,
  getDefaultBaseUrl,
  getDefaultModel,
  getProviderModels,
  testLlmConnection,
  type LlmProvider,
} from "../services/llm";
import { invoke } from "@tauri-apps/api/core";

// ── 静态配置 ────────────────────────────────────────────────────────

const PROVIDER_OPTIONS: { value: LlmProvider; label: string; emoji: string }[] = [
  { value: "deepseek", label: "DeepSeek", emoji: "🔍" },
  { value: "openai", label: "OpenAI", emoji: "🤖" },
  { value: "anthropic", label: "Anthropic", emoji: "🧠" },
  { value: "custom", label: "自定义", emoji: "⚙️" },
];

const THEME_OPTIONS: {
  value: "light" | "dark" | "system";
  label: string;
}[] = [
  { value: "light", label: "☀️ 亮色" },
  { value: "dark", label: "🌙 暗色" },
  { value: "system", label: "💻 跟随系统" },
];

// ── 组件 ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // ── Store ──
  const {
    workspace,
    selectWorkspace,
    refreshWorkspace,
    refreshLlmConfig,
    themePreference,
    setThemePreference,
  } = useAppStore();

  // ── 表单状态 ──
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<LlmProvider>("deepseek");
  const [model, setModel] = useState("");
  const [showKey, setShowKey] = useState(false);

  // ── UI 状态 ──
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latency: number;
    error?: string;
  } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // 已保存配置快照，用于脏状态对比
  const [savedConfig, setSavedConfig] = useState<{
    baseUrl: string;
    apiKey: string;
    provider: LlmProvider;
    model: string;
  } | null>(null);

  // ── 初始化：从后端加载已保存的配置 ──
  useEffect(() => {
    refreshWorkspace();
    refreshLlmConfig().then(() => {
      const config = useAppStore.getState().llmConfig;
      const p = config?.provider || detectProvider(config?.base_url || null);
      const url = config?.base_url || getDefaultBaseUrl(p) || "";
      const key = config?.api_key || "";
      const mdl = config?.model || getDefaultModel(p) || "";

      setProvider(p);
      setBaseUrl(url);
      setApiKey(key);
      setModel(mdl);

      const snap = { baseUrl: url, apiKey: key, provider: p, model: mdl };
      setSavedConfig(snap);
    });
  }, []);

  // ── 脏状态检测 ──
  const modifiedCount = savedConfig
    ? [
        baseUrl !== savedConfig.baseUrl,
        apiKey !== savedConfig.apiKey,
        provider !== savedConfig.provider,
        model !== savedConfig.model,
      ].filter(Boolean).length
    : 0;
  const isDirty = modifiedCount > 0;

  // ── 离开前确认（浏览器关闭/刷新） ──
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── Provider 切换 ──
  const handleProviderChange = useCallback((p: LlmProvider) => {
    setProvider(p);
    const defaultUrl = getDefaultBaseUrl(p);
    if (defaultUrl) setBaseUrl(defaultUrl);
    const defaultModel = getDefaultModel(p);
    if (defaultModel) setModel(defaultModel);
    setTestResult(null);
  }, []);

  // ── 测试连接 ──
  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setPageError(null);
    const startTime = Date.now();
    try {
      const effectiveModel = model || getDefaultModel(provider);
      const result = await testLlmConnection(
        baseUrl,
        apiKey,
        effectiveModel,
      );
      const latency = Date.now() - startTime;
      setTestResult({ ok: result.ok, latency, error: result.error });
    } catch (e) {
      setTestResult({
        ok: false,
        latency: Date.now() - startTime,
        error: String(e),
      });
    } finally {
      setTesting(false);
    }
  }, [baseUrl, apiKey, model, provider]);

  // ── 统一保存 ──
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setPageError(null);
    setTestResult(null);
    try {
      await saveLlmConfig(
        baseUrl || null,
        apiKey || null,
        provider,
        model || null,
      );
      await refreshLlmConfig();
      const snap = { baseUrl, apiKey, provider, model };
      setSavedConfig(snap);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setPageError(String(e));
    } finally {
      setSaving(false);
    }
  }, [baseUrl, apiKey, provider, model, refreshLlmConfig]);

  // ── 重置为已保存的值 ──
  const handleReset = useCallback(() => {
    if (!savedConfig) return;
    setBaseUrl(savedConfig.baseUrl);
    setApiKey(savedConfig.apiKey);
    setProvider(savedConfig.provider);
    setModel(savedConfig.model);
    setTestResult(null);
    setPageError(null);
  }, [savedConfig]);

  // ── 在文件管理器中打开工作区 ──
  const handleOpenWorkspace = useCallback(async () => {
    if (!workspace) return;
    try {
      await invoke("open_in_shell", { path: workspace });
    } catch {
      // 忽略：后端可能未实现该命令
    }
  }, [workspace]);

  // ── 当前 provider 的模型建议 ──
  const modelSuggestions = getProviderModels(provider);

  // ── 渲染 ──
  return (
    <div className="flex flex-col h-full">
      {/* 可滚动内容区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-5 p-6 pb-20">
          <div className="w-full max-w-lg flex flex-col gap-5">
            <h1 className="text-xl font-bold">设置</h1>

            {/* ── 错误横幅 ── */}
            {pageError && (
              <div className="p-3 rounded-lg border border-[var(--color-danger)] bg-red-50 dark:bg-red-950/20 text-sm text-[var(--color-danger)] flex items-start gap-2">
                <span className="shrink-0">⚠️</span>
                <span className="flex-1 break-all">{pageError}</span>
                <button
                  onClick={() => setPageError(null)}
                  className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer leading-none"
                >
                  ✕
                </button>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                Section 1: 工作区
                ══════════════════════════════════════════════════════ */}
            <section className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <h2 className="text-sm font-semibold mb-1">📁 工作区</h2>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">
                所有项目将以文件夹形式存储在此目录下
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workspace || ""}
                  readOnly
                  placeholder="未选择工作区"
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)]
                             bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                />
                <button
                  onClick={selectWorkspace}
                  className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium
                             hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer"
                >
                  浏览...
                </button>
                {workspace && (
                  <button
                    onClick={handleOpenWorkspace}
                    title="在文件管理器中打开"
                    className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm
                               text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]
                               transition-colors cursor-pointer"
                  >
                    📂
                  </button>
                )}
              </div>
              {workspace && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
                  ✅ 已生效
                </p>
              )}
            </section>

            {/* ══════════════════════════════════════════════════════
                Section 2: AI 配置
                ══════════════════════════════════════════════════════ */}
            <section className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <h2 className="text-sm font-semibold mb-1">🤖 AI 配置</h2>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">
                配置大语言模型 API 连接参数
              </p>

              {/* Provider 卡片选择 */}
              <div className="mb-4">
                <label className="block text-xs font-medium mb-2 text-[var(--color-text-secondary)]">
                  服务商
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {PROVIDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleProviderChange(opt.value)}
                      className={`flex flex-col items-center gap-1 px-2 py-3 rounded-lg border text-xs
                        transition-all cursor-pointer
                        ${
                          provider === opt.value
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent)] font-medium"
                            : "border-[var(--color-border)] hover:border-[var(--color-text-muted)] text-[var(--color-text-secondary)]"
                        }`}
                    >
                      <span className="text-lg">{opt.emoji}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* API 地址 */}
              <div className="mb-3">
                <label className="block text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
                  API 地址
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="https://api.deepseek.com"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)]
                             bg-[var(--color-bg)] text-[var(--color-text)] text-sm
                             outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>

              {/* 模型 */}
              <div className="mb-3">
                <label className="block text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
                  模型
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setTestResult(null);
                  }}
                  list="model-suggestions"
                  placeholder={getDefaultModel(provider) || "输入模型名称"}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)]
                             bg-[var(--color-bg)] text-[var(--color-text)] text-sm
                             outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
                <datalist id="model-suggestions">
                  {modelSuggestions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              {/* API 密钥 */}
              <div className="mb-4">
                <label className="block text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
                  API 密钥
                </label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="sk-..."
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)]
                               bg-[var(--color-bg)] text-[var(--color-text)] text-sm
                               outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="px-3 py-2 rounded-lg border border-[var(--color-border)]
                               text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]
                               cursor-pointer whitespace-nowrap"
                  >
                    {showKey ? "隐藏" : "显示"}
                  </button>
                </div>
              </div>

              {/* 测试连接 */}
              <div className="flex items-center gap-3 mb-1">
                <button
                  onClick={handleTestConnection}
                  disabled={testing || !baseUrl}
                  className="px-4 py-2 rounded-lg border border-[var(--color-border)]
                             text-sm text-[var(--color-text-secondary)]
                             hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {testing ? "测试中..." : "🔌 测试连接"}
                </button>
                {testResult && (
                  <span
                    className={`text-xs ${
                      testResult.ok
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-[var(--color-danger)]"
                    }`}
                  >
                    {testResult.ok
                      ? `✅ 连接成功，延迟 ${testResult.latency}ms`
                      : `❌ ${testResult.error || "连接失败"}`}
                  </span>
                )}
              </div>

              {/* 隐私说明 */}
              <div className="mt-3 p-3 rounded-lg bg-[var(--color-bg-tertiary)] text-xs text-[var(--color-text-muted)] leading-relaxed">
                🔒 API 密钥仅存储在本地应用配置文件中，不会发送到除所配置
                API 端点之外的任何服务器。
              </div>
            </section>

            {/* ══════════════════════════════════════════════════════
                Section 3: 外观
                ══════════════════════════════════════════════════════ */}
            <section className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <h2 className="text-sm font-semibold mb-1">🎨 外观</h2>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">
                选择应用主题配色方案
              </p>
              <div className="flex gap-2">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setThemePreference(opt.value)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-all cursor-pointer
                      ${
                        themePreference === opt.value
                          ? "border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent)] font-medium"
                          : "border-[var(--color-border)] hover:border-[var(--color-text-muted)] text-[var(--color-text-secondary)]"
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>

            {/* ══════════════════════════════════════════════════════
                Section 4: 关于
                ══════════════════════════════════════════════════════ */}
            <section className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <h2 className="text-sm font-semibold mb-1">ℹ️ 关于</h2>
              <div className="text-xs text-[var(--color-text-secondary)] space-y-1.5">
                <p>stock-wiki v0.1.0 — Tauri v2 + React</p>
                {workspace && (
                  <p className="flex items-center gap-1 flex-wrap">
                    <span>配置目录:</span>
                    <code className="text-[var(--color-accent)] text-xs break-all">
                      {workspace}
                    </code>
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* ── 底部固定保存栏 ── */}
      <div
        className={`shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-6 py-3
        flex items-center justify-between transition-shadow
        ${isDirty ? "shadow-[0_-2px_8px_rgba(0,0,0,0.08)]" : ""}`}
      >
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="text-xs text-[var(--color-text-muted)]">
              已修改 {modifiedCount} 项
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={!isDirty}
            className="px-4 py-2 rounded-lg border border-[var(--color-border)]
                       text-sm text-[var(--color-text-secondary)]
                       hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            重置
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={`px-5 py-2 rounded-lg text-white text-sm font-medium
                       transition-all cursor-pointer
                       disabled:opacity-40 disabled:cursor-not-allowed
                       ${
                         saved
                           ? "bg-emerald-500 hover:bg-emerald-600"
                           : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                       }`}
          >
            {saving ? "保存中..." : saved ? "✅ 已保存" : "保存设置"}
          </button>
        </div>
      </div>
    </div>
  );
}
