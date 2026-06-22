import { useEffect, useState } from "react";
import { useAppStore } from "../stores/appStore";
import {
  saveLlmConfig,
  detectProvider,
  getDefaultBaseUrl,
  type LlmProvider,
} from "../services/llm";

const PROVIDER_OPTIONS: { value: LlmProvider; label: string }[] = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Custom" },
];

export default function SettingsPage() {
  const {
    workspace,
    llmConfig,
    selectWorkspace,
    refreshWorkspace,
    refreshLlmConfig,
  } = useAppStore();

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<LlmProvider>("deepseek");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    refreshWorkspace();
    refreshLlmConfig().then(() => {
      const config = useAppStore.getState().llmConfig;
      if (config) {
        setBaseUrl(config.base_url || "");
        setApiKey(config.api_key || "");
        setProvider(config.provider || detectProvider(config.base_url));
      }
    });
  }, []);

  function handleProviderChange(p: LlmProvider) {
    setProvider(p);
    // 切换 provider 时自动填入默认 base_url（用户仍可手动覆盖）
    const defaultUrl = getDefaultBaseUrl(p);
    if (defaultUrl) setBaseUrl(defaultUrl);
  }

  async function handleSaveLlmConfig() {
    setSaving(true);
    setSaved(false);
    try {
      await saveLlmConfig(baseUrl || null, apiKey || null, provider);
      await refreshLlmConfig();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="w-full max-w-lg flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Settings</h1>

        {/* Workspace setting */}
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <label className="block text-sm font-medium mb-2">
            Workspace Folder
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            All your projects will be stored as folders inside this directory.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={workspace || ""}
              readOnly
              placeholder="No workspace selected"
              className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)]
                         bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
            />
            <button
              onClick={selectWorkspace}
              className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium
                         hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer"
            >
              Browse...
            </button>
          </div>
        </div>

        {/* LLM Configuration */}
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <label className="block text-sm font-medium mb-2">
            LLM API Configuration
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            OpenAI-compatible API endpoint. Default is DeepSeek.
          </p>

          {/* Base URL */}
          <div className="mb-3">
            <label className="block text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
              API Base URL
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com"
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)]
                         bg-[var(--color-bg)] text-[var(--color-text)] text-sm
                         outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>

          {/* Provider selector */}
          <div className="mb-3">
            <label className="block text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as LlmProvider)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)]
                         bg-[var(--color-bg)] text-[var(--color-text)] text-sm
                         outline-none focus:ring-2 focus:ring-[var(--color-accent)] cursor-pointer"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div className="mb-3">
            <label className="block text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
              API Key
            </label>
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)]
                           bg-[var(--color-bg)] text-[var(--color-text)] text-sm
                           outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="px-3 py-2 rounded-lg border border-[var(--color-border)]
                           text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]
                           cursor-pointer"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveLlmConfig}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium
                         hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save LLM Config"}
            </button>
            {saved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                ✅ Saved
              </span>
            )}
          </div>

          <p className="text-xs text-[var(--color-text-muted)] mt-3">
            ℹ️ API Key is stored locally in the app config file. It is never sent
            to any server other than the configured API endpoint.
          </p>
        </div>

        {/* Theme info */}
        <div className="px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm">
          <span className="text-[var(--color-text-secondary)]">Theme: </span>
          <span>Light / Dark — toggle via ☀️🌙 button in the top bar</span>
        </div>

        {/* App info */}
        <div className="px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm">
          <p className="text-[var(--color-text-secondary)]">
            stock-wiki v0.1.0 — Tauri v2 + React
          </p>
        </div>
      </div>
    </div>
  );
}
