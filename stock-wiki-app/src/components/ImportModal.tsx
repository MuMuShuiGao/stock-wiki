import { useState, useMemo } from "react";
import { useAppStore } from "../stores/appStore";

interface Props {
  projectName: string;
  rawDir: string;
  files: string[];
  onClose: () => void;
  onImportComplete?: () => void;
}

export default function ImportModal({
  projectName,
  rawDir,
  files,
  onClose,
  onImportComplete,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(() => {
    // Select all by default
    return new Set(files.map((_, i) => i));
  });
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ ok: number; fail: number; errors: string[] } | null>(null);

  const { importFiles } = useAppStore();

  const toggleFile = (index: number) => {
    if (importing) return;
    const next = new Set(selected);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelected(next);
  };

  const toggleAll = () => {
    if (importing) return;
    if (selected.size === files.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((_, i) => i)));
    }
  };

  const selectedFiles = useMemo(
    () => files.filter((_, i) => selected.has(i)),
    [selected, files],
  );

  function getFileName(filePath: string): string {
    return filePath.replace(/^.*[\\/]/, "");
  }

  function getFileExt(filePath: string): string {
    const name = getFileName(filePath);
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot).toLowerCase() : "";
  }

  function extIcon(ext: string): string {
    switch (ext) {
      case ".pdf": return "📕";
      case ".xlsx":
      case ".xls": return "📊";
      case ".csv": return "📋";
      case ".md":
      case ".markdown": return "📝";
      case ".txt": return "📄";
      case ".png":
      case ".jpg":
      case ".jpeg":
      case ".gif":
      case ".svg": return "🖼️";
      default: return "📎";
    }
  }

  async function handleImport() {
    if (selectedFiles.length === 0) return;
    setImporting(true);
    setResults(null);

    let ok = 0;
    let fail = 0;
    const errors: string[] = [];

    for (const filePath of selectedFiles) {
      try {
        await importFiles(filePath, rawDir);
        ok++;
      } catch (e) {
        fail++;
        errors.push(`${getFileName(filePath)}: ${String(e)}`);
      }
    }

    // Notify parent to refresh sidebar
    onImportComplete?.();

    setResults({ ok, fail, errors });
    setImporting(false);
  }

  const isDone = results !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-lg font-bold">导入文件</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              拖拽导入到项目 <span className="font-medium text-[var(--color-text)]">{projectName}</span>
              ，共 {files.length} 个文件
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={importing}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xl leading-none px-2 py-1 cursor-pointer
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✕
          </button>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {/* Select all toggle */}
          <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={selected.size === files.length && files.length > 0}
              onChange={toggleAll}
              disabled={importing}
              className="cursor-pointer"
            />
            {selected.size === files.length ? "取消全选" : "全选"}
          </label>

          <div className="border-t border-[var(--color-border)] my-1" />

          {files.map((filePath, i) => {
            const name = getFileName(filePath);
            const ext = getFileExt(filePath);
            const isSelected = selected.has(i);
            return (
              <label
                key={filePath}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors cursor-pointer
                  ${isSelected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                    : "border-transparent bg-[var(--color-bg-secondary)] opacity-60"
                  }
                  ${importing ? "cursor-default" : "hover:bg-[var(--color-bg-tertiary)]"}
                `}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleFile(i)}
                  disabled={importing}
                  className="cursor-pointer shrink-0"
                />
                <span className="text-lg shrink-0">{extIcon(ext)}</span>
                <span className="flex-1 text-sm truncate">{name}</span>
                <span className="text-xs text-[var(--color-text-muted)] shrink-0">{ext.slice(1).toUpperCase() || "FILE"}</span>
              </label>
            );
          })}
        </div>

        {/* Results */}
        {results && (
          <div className={`border-t border-[var(--color-border)] px-6 py-3 text-sm
            ${results.fail === 0
              ? "text-emerald-600 dark:text-emerald-400"
              : results.ok === 0
                ? "text-[var(--color-danger)]"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {results.fail === 0
              ? `✅ 成功导入 ${results.ok} 个文件`
              : results.ok === 0
                ? `❌ 全部 ${results.fail} 个文件导入失败`
                : `⚠️ ${results.ok} 个成功，${results.fail} 个失败`
            }
            {results.errors.length > 0 && (
              <details className="mt-1">
                <summary className="text-xs cursor-pointer">查看详情</summary>
                <ul className="mt-1 text-xs list-disc list-inside space-y-0.5">
                  {results.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Importing status */}
        {importing && (
          <div className="border-t border-[var(--color-border)] px-6 py-3 text-sm text-[var(--color-accent)]">
            ⏳ 正在导入文件...
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)]">
          <span className="text-xs text-[var(--color-text-muted)]">
            已选择 {selectedFiles.length} / {files.length} 个文件
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={importing}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)]
                         hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDone ? "关闭" : "取消"}
            </button>
            {!isDone && (
              <button
                onClick={handleImport}
                disabled={selectedFiles.length === 0 || importing}
                className="px-6 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium
                           hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                导入 {selectedFiles.length} 个文件
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
