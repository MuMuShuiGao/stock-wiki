import { useParams, Routes, Route } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useAppStore, type FileEntry, type BatchFileStatus } from "../stores/appStore";
import { WIKI_TYPES } from "../services/llm";
import AnalysisModal from "../components/AnalysisModal";
import ImportModal from "../components/ImportModal";
import MarkdownPreview from "../components/MarkdownPreview";
import GraphPage from "./GraphPage";

/** Shared textarea for editing markdown / plain text (shows raw source with # etc.) */
function FallbackTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-full p-4 resize-none outline-none font-mono text-sm
                 bg-transparent text-[var(--color-text)]"
      placeholder={placeholder}
    />
  );
}

export default function ProjectDetailPage() {
  const { projectName } = useParams<{ projectName: string }>();
  const decodedName = decodeURIComponent(projectName || "");

  const {
    workspace,
    selectedFile,
    fileContent,
    isEditing,
    error,
    pipelineState,
    setSelectedFile,
    setFileContent,
    setIsEditing,
    readFile,
    writeFile,
    deleteFile,
    setError,
    runIngestPipeline,
    confirmPlan,
    resetPipeline,
    setLastVisitedProject,
    batchProgress,
    runBatchIngestPipeline,
  } = useAppStore();

  // ── Context menu target ──
  const [contextFile, setContextFile] = useState<FileEntry | null>(null);

  // ── Sidebar data ──
  const [rawFiles, setRawFiles] = useState<FileEntry[]>([]);
  const [ingestedFiles, setIngestedFiles] = useState<FileEntry[]>([]);
  const [wikiTypeFiles, setWikiTypeFiles] = useState<Record<string, FileEntry[]>>({});
  const [wikiLogFiles, setWikiLogFiles] = useState<FileEntry[]>([]);
  const [wikiIndexFile, setWikiIndexFile] = useState<FileEntry | null>(null);
  const [expandedWikiTypes, setExpandedWikiTypes] = useState<Set<string>>(
    () => new Set(WIKI_TYPES),
  );
  const [showRawSection, setShowRawSection] = useState(true);
  const [showIngestedSection, setShowIngestedSection] = useState(false);
  const [showWikiLogs, setShowWikiLogs] = useState(false);

  // Batch selection for raw files
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const prevBatchRunning = useRef(batchProgress?.running ?? false);

  // Drag-and-drop import
  const [isDragOver, setIsDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<string[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);

  // Compute paths
  const projectDir = workspace ? `${workspace}\\${decodedName}` : "";
  const rawDir = projectDir ? `${projectDir}\\raw` : "";

  // 记住最后访问的项目，跨路由保持可用
  useEffect(() => {
    if (decodedName) {
      setLastVisitedProject(decodedName);
    }
  }, [decodedName, setLastVisitedProject]);

  // ── Load sidebar data ──
  async function loadSidebarData() {
    if (!projectDir) return;

    // Raw files
    try {
      const raw: FileEntry[] = await invoke("list_directory", {
        dirPath: `${projectDir}\\raw`,
      });
      setRawFiles(raw.filter((f) => !f.is_dir));
    } catch {
      setRawFiles([]);
    }

    // Ingested (archived) files
    try {
      const ingested: FileEntry[] = await invoke("list_directory", {
        dirPath: `${projectDir}\\ingested`,
      });
      setIngestedFiles(ingested.filter((f) => !f.is_dir));
    } catch {
      setIngestedFiles([]);
    }

    // Wiki pages by type
    const wikiDir = `${projectDir}\\wiki`;
    const typeFiles: Record<string, FileEntry[]> = {};
    for (const wikiType of WIKI_TYPES) {
      try {
        const entries: FileEntry[] = await invoke("list_directory", {
          dirPath: `${wikiDir}\\${wikiType}`,
        });
        typeFiles[wikiType] = entries.filter(
          (f) => !f.is_dir && (f.name.endsWith(".md") || f.name.endsWith(".mdx")),
        );
      } catch {
        typeFiles[wikiType] = [];
      }
    }
    setWikiTypeFiles(typeFiles);

    // Wiki logs
    try {
      const logs: FileEntry[] = await invoke("list_directory", {
        dirPath: `${wikiDir}\\logs`,
      });
      setWikiLogFiles(logs.filter((f) => !f.is_dir));
    } catch {
      setWikiLogFiles([]);
    }

    // Index file reference
    setWikiIndexFile({
      name: "index.md",
      path: `${wikiDir}\\index.md`,
      is_dir: false,
    });
  }

  // Init + ensure wiki dirs
  useEffect(() => {
    if (projectDir) {
      loadSidebarData();
      invoke("ensure_wiki_dirs", { projectName: decodedName }).catch(() => {});
    }
  }, [projectDir]);

  // Refresh sidebar when pipeline completes
  const prevPipelineStatus = useRef(pipelineState.status);
  useEffect(() => {
    const prev = prevPipelineStatus.current;
    prevPipelineStatus.current = pipelineState.status;
    if (
      (prev === "updating" || prev === "creating" || prev === "housekeeping") &&
      pipelineState.status === "done"
    ) {
      loadSidebarData();
    }
  }, [pipelineState.status]);

  // Auto-select all raw files when list changes (and no batch running)
  useEffect(() => {
    if (!batchProgress?.running && rawFiles.length > 0) {
      setBatchSelected(new Set(rawFiles.map((f) => f.path)));
    }
  }, [rawFiles]);

  // Refresh sidebar when batch completes
  useEffect(() => {
    const prev = prevBatchRunning.current;
    prevBatchRunning.current = batchProgress?.running ?? false;
    if (prev && !batchProgress?.running) {
      loadSidebarData();
    }
  }, [batchProgress?.running]);

  // Drag-and-drop listeners
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const handleDragEnter = () => setIsDragOver(true);
    listen("tauri://drag-enter", handleDragEnter).then((fn) => unlisteners.push(fn));
    listen("tauri://drag-over", handleDragEnter).then((fn) => unlisteners.push(fn));

    listen("tauri://drag-leave", () => {
      setIsDragOver(false);
    }).then((fn) => unlisteners.push(fn));

    listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      setIsDragOver(false);
      const paths = event.payload.paths || [];
      if (paths.length > 0) {
        setDroppedFiles(paths);
        setShowImportModal(true);
      }
    }).then((fn) => unlisteners.push(fn));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  async function handleFileClick(entry: FileEntry) {
    setSelectedFile(entry);
    await readFile(entry.path);
    setIsEditing(false);
  }

  async function handleSave() {
    if (!selectedFile) return;
    await writeFile(selectedFile.path, fileContent);
    setIsEditing(false);
  }

  async function handleDelete() {
    if (!selectedFile) return;
    if (confirm(`Delete "${selectedFile.name}"?`)) {
      await deleteFile(selectedFile.path);
      setSelectedFile(null);
      await loadSidebarData();
    }
  }

  async function handleAnalyzeFile(file: FileEntry) {
    if (file.is_dir) return;
    if (batchProgress?.running) return;
    setContextFile(null);
    await runIngestPipeline(decodedName, file.path);
  }

  function toggleWikiType(wikiType: string) {
    setExpandedWikiTypes((prev) => {
      const next = new Set(prev);
      if (next.has(wikiType)) next.delete(wikiType);
      else next.add(wikiType);
      return next;
    });
  }

  const isMarkdown =
    selectedFile?.name.endsWith(".md") || selectedFile?.name.endsWith(".mdx");

  // ── Render helpers ──

  function renderFileEntry(file: FileEntry, indentLevel: number = 0) {
    const isSelected = selectedFile?.path === file.path;
    return (
      <div
        key={file.path}
        onClick={() => handleFileClick(file)}
        onContextMenu={(e) => {
          e.stopPropagation();
          setContextFile(file);
        }}
        className={`file-tree-item flex items-center gap-1.5 px-2 py-1.5 rounded text-sm select-none cursor-pointer
          ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${12 + indentLevel * 16}px` }}
      >
        <span className="truncate">{file.name}</span>
      </div>
    );
  }

  function toggleBatchFile(filePath: string) {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  function selectAllRaw() {
    setBatchSelected(new Set(rawFiles.map((f) => f.path)));
  }

  function deselectAllRaw() {
    setBatchSelected(new Set());
  }

  async function handleBatchGenerate() {
    if (batchProgress?.running) return;
    if (pipelineState.status !== "idle" && pipelineState.status !== "done" && pipelineState.status !== "error") return;
    const selectedPaths = rawFiles
      .filter((f) => batchSelected.has(f.path))
      .map((f) => f.path);
    if (selectedPaths.length === 0) return;
    await runBatchIngestPipeline(decodedName, selectedPaths);
  }

  function getBatchFileStatus(filePath: string): BatchFileStatus | undefined {
    return batchProgress?.files.find((f) => f.path === filePath);
  }

  function renderRawSection() {
    const selectedCount = rawFiles.filter((f) => batchSelected.has(f.path)).length;
    const allSelected = rawFiles.length > 0 && selectedCount === rawFiles.length;
    const isBatchRunning = batchProgress?.running ?? false;

    return (
      <div className="border-b border-[var(--color-border)]">
        {/* Header */}
        <div
          onClick={() => setShowRawSection(!showRawSection)}
          className="px-3 py-2 flex items-center gap-1.5 text-xs font-semibold
                     text-[var(--color-text-muted)] uppercase tracking-wide
                     cursor-pointer hover:bg-[var(--color-bg-tertiary)] select-none"
        >
          <span className="text-[10px]">{showRawSection ? "▼" : "▶"}</span>
          <span>原始文件</span>
          <span className="font-normal normal-case opacity-60">
            ({rawFiles.length})
          </span>
          {/* Select/deselect toggles (hidden during batch) */}
          {showRawSection && rawFiles.length > 0 && !isBatchRunning && (
            <span className="ml-auto flex gap-1" onClick={(e) => e.stopPropagation()}>
              {!allSelected && (
                <button
                  className="text-[10px] px-1.5 py-0.5 rounded hover:bg-[var(--color-accent)]/10
                             text-[var(--color-accent)] normal-case font-normal"
                  onClick={selectAllRaw}
                >
                  全选
                </button>
              )}
              {selectedCount > 0 && (
                <button
                  className="text-[10px] px-1.5 py-0.5 rounded hover:bg-[var(--color-border)]
                             text-[var(--color-text-muted)] normal-case font-normal"
                  onClick={deselectAllRaw}
                >
                  取消
                </button>
              )}
            </span>
          )}
        </div>

        {showRawSection && (
          rawFiles.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[var(--color-text-muted)]/60 italic leading-relaxed">
              拖放文件到此处导入原始资料
            </p>
          ) : (
            <div className="pb-1">
              {/* File list with checkboxes */}
              {rawFiles.map((f) => {
                const isSelected = selectedFile?.path === f.path;
                const checked = batchSelected.has(f.path);
                const bs = getBatchFileStatus(f.path);
                const showStatus = isBatchRunning || (bs && bs.status !== "pending");

                return (
                  <div
                    key={f.path}
                    onContextMenu={(e) => {
                      e.stopPropagation();
                      setContextFile(f);
                    }}
                    className={`file-tree-item flex items-center gap-1.5 px-2 py-1.5 rounded text-sm select-none
                      ${isSelected ? "selected" : ""}`}
                    style={{ paddingLeft: "12px" }}
                  >
                    {/* Checkbox */}
                    <span
                      className="flex-shrink-0 w-4 h-4 flex items-center justify-center
                                 rounded border border-[var(--color-border)] text-[11px]
                                 cursor-pointer hover:border-[var(--color-accent)]
                                 bg-[var(--color-bg)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isBatchRunning) toggleBatchFile(f.path);
                      }}
                    >
                      {checked ? "☑" : "☐"}
                    </span>

                    {/* Filename — click to open */}
                    <span
                      className="truncate cursor-pointer flex-1"
                      onClick={() => handleFileClick(f)}
                    >
                      {f.name}
                    </span>

                    {/* Batch status indicator */}
                    {showStatus && (
                      <span className="flex-shrink-0 text-[10px] ml-1">
                        {bs?.status === "processing" && (
                          <span className="text-[var(--color-accent)]">🔄</span>
                        )}
                        {bs?.status === "done" && (
                          <span className="text-[var(--color-success)]">✅</span>
                        )}
                        {bs?.status === "error" && (
                          <span
                            className="text-[var(--color-danger)] cursor-help"
                            title={bs.error}
                          >
                            ❌
                          </span>
                        )}
                        {bs?.status === "pending" && (
                          <span className="opacity-30">⏳</span>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Batch action bar */}
              <div className="px-2 pt-1 pb-0.5">
                {isBatchRunning ? (
                  <div className="text-[11px] text-[var(--color-accent)] text-center py-1">
                    ⏳ 生成中{" "}
                    {batchProgress!.files.filter((f) => f.status === "done" || f.status === "error").length}
                    /{batchProgress!.files.length}...
                  </div>
                ) : (
                  selectedCount > 0 && (
                    <button
                      className="w-full py-1 text-xs rounded
                                 bg-[var(--color-accent)] text-white
                                 hover:opacity-90 cursor-pointer
                                 disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={handleBatchGenerate}
                    >
                      ⚡ 一键生成选中 ({selectedCount})
                    </button>
                  )
                )}
              </div>
            </div>
          )
        )}
      </div>
    );
  }

  function renderIngestedSection() {
    return (
      <div className="border-b border-[var(--color-border)]">
        <div
          onClick={() => setShowIngestedSection(!showIngestedSection)}
          className="px-3 py-2 flex items-center gap-1.5 text-xs font-semibold
                     text-[var(--color-text-muted)] uppercase tracking-wide
                     cursor-pointer hover:bg-[var(--color-bg-tertiary)] select-none"
        >
          <span className="text-[10px]">{showIngestedSection ? "▼" : "▶"}</span>
          <span>已归档</span>
          <span className="font-normal normal-case opacity-60">
            ({ingestedFiles.length})
          </span>
        </div>
        {showIngestedSection && (
          ingestedFiles.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[var(--color-text-muted)]/60 italic leading-relaxed">
              暂无已归档文件
            </p>
          ) : (
            <div className="pb-1">
              {ingestedFiles.map((f) => renderFileEntry(f, 0))}
            </div>
          )
        )}
      </div>
    );
  }

  function renderWikiSection() {
    const totalPages = Object.values(wikiTypeFiles).reduce(
      (sum, arr) => sum + arr.length, 0,
    );

    return (
      <div className="flex-1 overflow-y-auto">
        {/* Section header */}
        <div className="px-3 py-2 flex items-center gap-1.5 text-xs font-semibold
                        text-[var(--color-text-muted)] uppercase tracking-wide">
          <span>Wiki 知识库</span>
          <span className="font-normal normal-case opacity-60">({totalPages})</span>
        </div>

        {/* Index entry */}
        {wikiIndexFile && (
          <div
            onClick={() => handleFileClick(wikiIndexFile)}
            className={`file-tree-item flex items-center gap-1.5 px-2 py-1.5
                        rounded text-sm select-none cursor-pointer
                        ${selectedFile?.path === wikiIndexFile.path ? "selected" : ""}`}
            style={{ paddingLeft: "12px" }}
          >
            <span className="truncate font-medium">index.md</span>
          </div>
        )}

        {/* Empty state */}
        {totalPages === 0 && (
          <p className="px-4 py-3 text-xs text-[var(--color-text-muted)]/60 italic leading-relaxed">
            暂无 Wiki 页面。导入原始文件并右键选择"分析生成 Wiki"开始。
          </p>
        )}

        {/* Type groups */}
        {WIKI_TYPES.map((wikiType) => {
          const files = wikiTypeFiles[wikiType] || [];
          const isExpanded = expandedWikiTypes.has(wikiType);

          return (
            <div key={wikiType}>
              <div
                onClick={() => toggleWikiType(wikiType)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-sm cursor-pointer
                           hover:bg-[var(--color-bg-tertiary)] select-none
                           text-[var(--color-text)]"
              >
                <span className="text-[10px] w-4 text-center">
                  {isExpanded ? "▼" : "▶"}
                </span>
                <span className="font-medium">{wikiType}</span>
                <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                  {files.length}
                </span>
              </div>
              {isExpanded && (
                files.length === 0 ? (
                  <p className="px-8 py-1 text-xs text-[var(--color-text-muted)]/50 italic">
                    暂无页面
                  </p>
                ) : (
                  files.map((f) => renderFileEntry(f, 1))
                )
              )}
            </div>
          );
        })}

        {/* Logs section (collapsed by default) */}
        {wikiLogFiles.length > 0 && (
          <div className="border-t border-[var(--color-border)] mt-1 pt-0.5">
            <div
              onClick={() => setShowWikiLogs((prev) => !prev)}
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs
                         text-[var(--color-text-muted)] cursor-pointer
                         hover:bg-[var(--color-bg-tertiary)] select-none"
            >
              <span className="text-[10px] w-4 text-center">
                {showWikiLogs ? "▼" : "▶"}
              </span>
              <span>摄入日志</span>
              <span className="ml-auto">{wikiLogFiles.length}</span>
            </div>
            {showWikiLogs && wikiLogFiles.map((f) => renderFileEntry(f, 1))}
          </div>
        )}
      </div>
    );
  }

  const showAnalysisModal = pipelineState.plan != null;

  return (
    <>
      <Routes>
        {/* 文件视图（默认）：侧边栏 + 编辑器 */}
        <Route
          path="/"
          element={
            <div className="flex h-full relative">
              {/* Drag-and-drop overlay */}
              {isDragOver && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--color-accent)]/15 backdrop-blur-sm border-2 border-dashed border-[var(--color-accent)] rounded-lg">
                  <div className="text-center pointer-events-none">
                    <p className="text-5xl mb-3">📥</p>
                    <p className="text-xl font-bold text-[var(--color-accent)]">
                      释放文件以导入
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                      文件将被复制到 <span className="font-medium">{decodedName}/raw/</span>
                    </p>
                  </div>
                </div>
              )}

              {/* Sidebar */}
              <aside
                className="w-64 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-sidebar)]
                                flex flex-col"
              >
                {/* Simplified header — project name only */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
                  <span className="font-semibold text-sm truncate">
                    📁 {decodedName}
                  </span>
                </div>

                {/* Pipeline status indicator */}
                {(pipelineState.status === "extracting" ||
                  pipelineState.status === "analyzing" ||
                  pipelineState.status === "planning") && (
                  <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-accent)]/10">
                    <p className="text-xs text-[var(--color-accent)]">
                      {pipelineState.status === "extracting"
                        ? "📄 提取文件文本..."
                        : pipelineState.status === "analyzing"
                          ? "🔍 LLM 分析源文档..."
                          : "📋 LLM 规划变更..."}
                    </p>
                  </div>
                )}

                {/* ── Raw Section with context menu ── */}
                <ContextMenu.Root>
                  <ContextMenu.Trigger className="contents">
                    {renderRawSection()}
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content
                      className="min-w-[180px] bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)]
                                 shadow-xl p-1 z-50"
                    >
                      {contextFile && !contextFile.is_dir &&
                       rawFiles.some((f) => f.path === contextFile.path) &&
                       !batchProgress?.running && (
                        <ContextMenu.Item
                          onClick={() => handleAnalyzeFile(contextFile)}
                          className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer
                                     hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]
                                     outline-none"
                        >
                          🤖 分析生成 Wiki
                        </ContextMenu.Item>
                      )}
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>

                {/* ── Ingested Section (read-only) ── */}
                {renderIngestedSection()}

                {/* ── Wiki Section ── */}
                {renderWikiSection()}
              </aside>

              {/* Main content area */}
              <main className="flex-1 flex flex-col min-w-0">
                {selectedFile ? (
                  <>
                    {/* Toolbar */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
                      <span className="text-sm font-medium truncate">
                        {selectedFile.name}
                      </span>
                      <div className="flex gap-1 items-center">
                        {isEditing && (
                          <button
                            onClick={handleSave}
                            className="px-3 py-1 text-xs rounded bg-[var(--color-success)] text-white
                                       hover:opacity-90 cursor-pointer"
                          >
                            Save
                          </button>
                        )}
                        {isMarkdown && (
                          <button
                            onClick={() => setIsEditing(!isEditing)}
                            className={`px-3 py-1 text-xs rounded cursor-pointer
                              ${isEditing
                                ? "bg-[var(--color-accent)] text-white"
                                : "bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)]"
                              }`}
                          >
                            {isEditing ? "Done" : "Edit"}
                          </button>
                        )}
                        <button
                          onClick={handleDelete}
                          className="px-2 py-1 text-xs rounded text-[var(--color-text-muted)]
                                     hover:text-[var(--color-danger)] cursor-pointer"
                        >
                          🗑
                        </button>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 flex overflow-hidden">
                      {isEditing ? (
                        <div className="flex-1 bg-[var(--color-editor-bg)]">
                          <FallbackTextarea
                            value={fileContent}
                            onChange={setFileContent}
                            placeholder={isMarkdown ? "# Markdown 源码..." : "Start writing..."}
                          />
                        </div>
                      ) : (
                        <div className="flex-1 overflow-y-auto p-4">
                          <MarkdownPreview content={fileContent} />
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
                    <p>Select a file to view or edit</p>
                  </div>
                )}
              </main>
            </div>
          }
        />

        {/* 图谱视图（全屏，无侧边栏） */}
        <Route path="/graph" element={<GraphPage />} />
      </Routes>

      {/* Import modal（两个视图共享） */}
      {showImportModal && (
        <ImportModal
          projectName={decodedName}
          rawDir={rawDir}
          files={droppedFiles}
          onClose={() => {
            setShowImportModal(false);
            setDroppedFiles([]);
          }}
          onImportComplete={() => loadSidebarData()}
        />
      )}

      {/* Analysis modal（两个视图共享） */}
      {showAnalysisModal && pipelineState.plan && (
        <AnalysisModal
          plan={pipelineState.plan}
          pipelineState={pipelineState}
          onClose={() => resetPipeline()}
          onConfirm={(confirmedPlan) => confirmPlan(decodedName, confirmedPlan)}
        />
      )}

      {/* Error toast（两个视图共享） */}
      {error && (
        <div
          className="fixed bottom-4 right-4 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20
                        text-red-600 dark:text-red-400 text-sm shadow-lg max-w-md"
        >
          {error}
          <button
            className="ml-2 underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
