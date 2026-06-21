import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAppStore } from "../stores/appStore";

export default function SettingsPage() {
  const { workspace, selectWorkspace, refreshWorkspace } = useAppStore();

  useEffect(() => {
    refreshWorkspace();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="w-full max-w-lg flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Settings</h1>
          <Link to="/" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
            ← Back
          </Link>
        </div>

        {/* Workspace setting */}
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <label className="block text-sm font-medium mb-2">Workspace Folder</label>
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

        {/* Theme info */}
        <div className="px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm">
          <span className="text-[var(--color-text-secondary)]">Theme: </span>
          <span>Auto (follows system preference)</span>
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
