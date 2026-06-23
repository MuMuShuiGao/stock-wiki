import { useParams, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useAppStore } from "../stores/appStore";
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
    files,
    selectedFile,
    fileContent,
    isEditing,
    error,
    pipelineState,
    refreshFiles,
    setSelectedFile,
    setFileContent,
    setIsEditing,
    readFile,
    writeFile,
    createFile,
    createFolder,
    deleteFile,
    setError,
    runIngestPipeline,
    confirmPlan,
    resetPipeline,
    setLastVisitedProject,
  } = useAppStore();

  const [newItemName, setNewItemName] = useState("");
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [contextFile, setContextFile] = useState<typeof files[0] | null>(null);

  // ── 目录导航 ──
  const [currentDir, setCurrentDir] = useState("");
  const [dirStack, setDirStack] = useState<string[]>([]);

  // ── 文件夹展开 ──
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderChildren, setFolderChildren] = useState<Record<string, typeof files>>({});

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

  // 初始化：首次拿到 projectDir 时设置 currentDir
  useEffect(() => {
    if (projectDir && !currentDir) {
      setCurrentDir(projectDir);
    }
  }, [projectDir]);

  // currentDir 变化时刷新文件列表
  useEffect(() => {
    if (currentDir) {
      refreshFiles(currentDir);
      invoke("ensure_wiki_dirs", { projectName: decodedName }).catch(() => {});
    }
  }, [currentDir]);

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

  async function handleFileClick(entry: typeof files[0]) {
    setSelectedFile(entry);
    if (!entry.is_dir) {
      await readFile(entry.path);
      setIsEditing(false);
    } else {
      // 文件夹单击：仅展开/折叠，不导航进入
      toggleExpand(entry);
    }
  }

  /** 双击进入文件夹 */
  function handleFolderDoubleClick(entry: typeof files[0]) {
    if (!entry.is_dir) return;
    setDirStack((prev) => [...prev, currentDir]);
    setCurrentDir(entry.path);
    setSelectedFile(null);
    setExpandedFolders(new Set());
    setFolderChildren({});
  }

  function handleBack() {
    const parent = dirStack[dirStack.length - 1];
    if (!parent) return;
    setDirStack((prev) => prev.slice(0, -1));
    setCurrentDir(parent);
    setSelectedFile(null);
    // 清空展开状态
    setExpandedFolders(new Set());
    setFolderChildren({});
  }

  async function toggleExpand(entry: typeof files[0]) {
    const path = entry.path;
    if (expandedFolders.has(path)) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } else {
      try {
        const children: typeof files = await invoke("list_directory", { dirPath: path });
        setFolderChildren((prev) => ({ ...prev, [path]: children }));
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.add(path);
          return next;
        });
      } catch {
        // 权限不足或读取失败，静默忽略
      }
    }
  }

  function handleToggleExpand(e: React.MouseEvent, entry: typeof files[0]) {
    e.stopPropagation();
    toggleExpand(entry);
  }

  async function handleSave() {
    if (!selectedFile) return;
    await writeFile(selectedFile.path, fileContent);
    setIsEditing(false);
  }

  async function handleCreateFile() {
    const name = newItemName.trim();
    if (!name) return;
    await createFile(currentDir, name, "");
    setNewItemName("");
    setShowNewFileInput(false);
  }

  async function handleCreateFolder() {
    const name = newItemName.trim();
    if (!name) return;
    await createFolder(currentDir, name);
    setNewItemName("");
    setShowNewFolderInput(false);
  }

  async function handleDelete() {
    if (!selectedFile) return;
    const label = selectedFile.is_dir ? "folder" : "file";
    if (confirm(`Delete ${label} "${selectedFile.name}"?`)) {
      await deleteFile(selectedFile.path);
      setSelectedFile(null);
    }
  }

  async function handleAnalyzeFile(file: typeof files[0]) {
    if (file.is_dir) return;
    setContextFile(null);
    await runIngestPipeline(decodedName, file.path);
  }

  const isMarkdown =
    selectedFile?.name.endsWith(".md") || selectedFile?.name.endsWith(".mdx");

  /** 递归渲染目录树 */
  function renderEntries(entries: typeof files, depth: number): React.ReactNode {
    return entries.map((entry) => {
      const isExpanded = expandedFolders.has(entry.path);
      const children = folderChildren[entry.path];

      return (
        <div key={entry.path}>
          <div
            onClick={() => handleFileClick(entry)}
            onDoubleClick={entry.is_dir ? () => handleFolderDoubleClick(entry) : undefined}
            onContextMenu={() => setContextFile(entry)}
            className={`file-tree-item flex items-center gap-1 px-2 py-1.5 rounded text-sm select-none
              ${selectedFile?.path === entry.path ? "selected" : ""}`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
          >
            {/* 展开/折叠箭头 */}
            {entry.is_dir ? (
              <span
                onClick={(e) => handleToggleExpand(e, entry)}
                className="text-xs w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--color-bg-tertiary)] cursor-pointer shrink-0"
              >
                {isExpanded ? "▼" : "▶"}
              </span>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="text-sm shrink-0">
              {entry.is_dir ? (isExpanded ? "📂" : "📁") : "📄"}
            </span>
            <span className="truncate">{entry.name}</span>
          </div>
          {/* 递归渲染展开的子目录 */}
          {entry.is_dir && isExpanded && children && children.length > 0 && (
            <div>{renderEntries(children, depth + 1)}</div>
          )}
        </div>
      );
    });
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
                {/* Project header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
                  {dirStack.length > 0 && (
                    <button
                      onClick={handleBack}
                      title="返回上级目录"
                      className="text-lg leading-none px-1 py-0.5 rounded hover:bg-[var(--color-bg-tertiary)] cursor-pointer shrink-0"
                    >
                      ←
                    </button>
                  )}
                  <span className="font-semibold text-sm truncate">
                    📁 {currentDir === projectDir ? decodedName : currentDir.replace(projectDir + "\\", "")}
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

                {/* File tree */}
                <ContextMenu.Root>
                  <ContextMenu.Trigger className="flex-1 overflow-y-auto p-2">
                    {files.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)] p-2">
                        Empty project. Create a file or folder to start.
                      </p>
                    ) : (
                      renderEntries(files, 0)
                    )}
                  </ContextMenu.Trigger>

                  <ContextMenu.Portal>
                    <ContextMenu.Content
                      className="min-w-[180px] bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)]
                                 shadow-xl p-1 z-50"
                    >
                      {contextFile && !contextFile.is_dir && (
                        <ContextMenu.Item
                          onClick={() => handleAnalyzeFile(contextFile)}
                          className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer
                                     hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]
                                     outline-none"
                        >
                          🤖 分析生成 Wiki
                        </ContextMenu.Item>
                      )}
                      <ContextMenu.Item
                        onClick={() => {
                          setShowNewFileInput(true);
                          setShowNewFolderInput(false);
                          setNewItemName("");
                          setContextFile(null);
                        }}
                        className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer
                                   hover:bg-[var(--color-bg-tertiary)] outline-none"
                      >
                        + 新建文件
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        onClick={() => {
                          setShowNewFolderInput(true);
                          setShowNewFileInput(false);
                          setNewItemName("");
                          setContextFile(null);
                        }}
                        className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer
                                   hover:bg-[var(--color-bg-tertiary)] outline-none"
                      >
                        + 新建文件夹
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>

                {/* New item inputs */}
                {(showNewFileInput || showNewFolderInput) && (
                  <div className="border-t border-[var(--color-border)] p-2 flex gap-1">
                    <input
                      type="text"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          showNewFileInput ? handleCreateFile() : handleCreateFolder();
                        }
                        if (e.key === "Escape") {
                          setShowNewFileInput(false);
                          setShowNewFolderInput(false);
                          setNewItemName("");
                        }
                      }}
                      placeholder={showNewFileInput ? "file.md" : "folder name"}
                      autoFocus
                      className="flex-1 px-2 py-1 text-xs rounded border border-[var(--color-border)]
                                 bg-[var(--color-bg)] text-[var(--color-text)] outline-none"
                    />
                  </div>
                )}

                {/* Actions */}
                <div className="border-t border-[var(--color-border)] p-2 flex gap-1">
                  <button
                    onClick={() => {
                      setShowNewFileInput(true);
                      setShowNewFolderInput(false);
                      setNewItemName("");
                    }}
                    className="flex-1 px-2 py-1.5 text-xs rounded hover:bg-[var(--color-bg-tertiary)] cursor-pointer"
                  >
                    + File
                  </button>
                  <button
                    onClick={() => {
                      setShowNewFolderInput(true);
                      setShowNewFileInput(false);
                      setNewItemName("");
                    }}
                    className="flex-1 px-2 py-1.5 text-xs rounded hover:bg-[var(--color-bg-tertiary)] cursor-pointer"
                  >
                    + Folder
                  </button>
                </div>
              </aside>

              {/* Main content area */}
              <main className="flex-1 flex flex-col min-w-0">
                {selectedFile && !selectedFile.is_dir ? (
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
                ) : selectedFile?.is_dir ? (
                  <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
                    <div className="text-center">
                      <p className="text-3xl mb-2">📁</p>
                      <p className="text-sm">{selectedFile.name}</p>
                      <p className="text-xs mt-1">双击进入文件夹 · 单击展开子目录</p>
                    </div>
                  </div>
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
          projectDir={projectDir}
          rawDir={rawDir}
          files={droppedFiles}
          onClose={() => {
            setShowImportModal(false);
            setDroppedFiles([]);
          }}
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
