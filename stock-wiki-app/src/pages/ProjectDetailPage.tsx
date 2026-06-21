import { useParams } from "react-router-dom";
import { useEffect, useState, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useAppStore } from "../stores/appStore";
import AnalysisModal from "../components/AnalysisModal";
import ImportModal from "../components/ImportModal";
import MarkdownPreview from "../components/MarkdownPreview";
import ErrorBoundary from "../components/ErrorBoundary";

// Milkdown is heavy (~10 MB) — only load when user starts editing
const MarkdownEditor = lazy(() => import("../components/MarkdownEditor"));

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
    pipelineStatus,
    preAnalysisEntities,
    extractedText,
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
    startPreAnalysis,
    resetPipeline,
  } = useAppStore();

  const [newItemName, setNewItemName] = useState("");
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [contextFile, setContextFile] = useState<typeof files[0] | null>(null);

  // Drag-and-drop import
  const [isDragOver, setIsDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<string[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);

  // Compute current directory path
  const projectDir = workspace ? `${workspace}\\${decodedName}` : "";
  const rawDir = projectDir ? `${projectDir}\\raw` : "";

  useEffect(() => {
    if (projectDir) {
      refreshFiles(projectDir);
      // Ensure wiki dirs exist
      invoke("ensure_wiki_dirs", { projectName: decodedName }).catch(() => {});
    }
  }, [projectDir]);

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
      await refreshFiles(entry.path);
    }
  }

  async function handleSave() {
    if (!selectedFile) return;
    await writeFile(selectedFile.path, fileContent);
    setIsEditing(false);
  }

  async function handleCreateFile() {
    const name = newItemName.trim();
    if (!name) return;
    await createFile(projectDir, name, "");
    setNewItemName("");
    setShowNewFileInput(false);
  }

  async function handleCreateFolder() {
    const name = newItemName.trim();
    if (!name) return;
    await createFolder(projectDir, name);
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
    await startPreAnalysis(decodedName, file.path);
  }

  const isMarkdown =
    selectedFile?.name.endsWith(".md") || selectedFile?.name.endsWith(".mdx");

  const showAnalysisModal =
    pipelineStatus === "awaiting_confirmation" ||
    pipelineStatus === "generating" ||
    pipelineStatus === "done";

  return (
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
        <div className="flex items-center px-4 py-3 border-b border-[var(--color-border)]">
          <span className="font-semibold text-sm truncate">📁 {decodedName}</span>
        </div>

        {/* Pipeline status indicator */}
        {(pipelineStatus === "extracting" || pipelineStatus === "pre_analyzing") && (
          <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-accent)]/10">
            <p className="text-xs text-[var(--color-accent)]">
              {pipelineStatus === "extracting"
                ? "📄 提取文件文本..."
                : "🤖 LLM 预分析中..."}
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
              files.map((entry) => (
                <div
                  key={entry.path}
                  onClick={() => handleFileClick(entry)}
                  onContextMenu={() => setContextFile(entry)}
                  className={`file-tree-item flex items-center gap-2 px-2 py-1.5 rounded text-sm
                    ${selectedFile?.path === entry.path ? "selected" : ""}`}
                >
                  <span className="text-sm">
                    {entry.is_dir ? "📁" : "📄"}
                  </span>
                  <span className="truncate">{entry.name}</span>
                </div>
              ))
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
                    {isEditing ? "Editing" : "Preview"}
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
              {isEditing && isMarkdown ? (
                <>
                  {/* Editor pane */}
                  <div className="flex-1 border-r border-[var(--color-border)] bg-[var(--color-editor-bg)] overflow-hidden">
                    <ErrorBoundary fallback={
                      <textarea
                        value={fileContent}
                        onChange={(e) => setFileContent(e.target.value)}
                        className="w-full h-full p-4 resize-none outline-none font-mono text-sm
                                   bg-transparent text-[var(--color-text)]"
                      />
                    }>
                      <Suspense fallback={
                        <textarea
                          value={fileContent}
                          onChange={(e) => setFileContent(e.target.value)}
                          className="w-full h-full p-4 resize-none outline-none font-mono text-sm
                                     bg-transparent text-[var(--color-text)]"
                          placeholder="Loading editor..."
                        />
                      }>
                        <MarkdownEditor
                          value={fileContent}
                          onChange={(v) => setFileContent(v)}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  </div>
                  {/* Preview pane */}
                  <div className="flex-1 overflow-y-auto p-4 bg-[var(--color-preview-bg)]">
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">
                      Preview
                    </p>
                    <ErrorBoundary fallback={
                      <pre className="whitespace-pre-wrap font-sans text-sm text-[var(--color-text)]">
                        {fileContent || "(empty)"}
                      </pre>
                    }>
                      <MarkdownPreview content={fileContent} />
                    </ErrorBoundary>
                  </div>
                </>
              ) : isEditing && !isMarkdown ? (
                <div className="flex-1 bg-[var(--color-editor-bg)]">
                  <textarea
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    className="w-full h-full p-4 resize-none outline-none font-mono text-sm
                               bg-transparent text-[var(--color-text)]"
                    placeholder="Start writing..."
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
              <p className="text-xs mt-1">Select a file inside this folder</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
            <p>Select a file to view or edit</p>
          </div>
        )}
      </main>

      {/* Import modal */}
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

      {/* Analysis modal */}
      {showAnalysisModal && (
        <AnalysisModal
          projectName={decodedName}
          sourceText={extractedText}
          entities={preAnalysisEntities}
          onClose={() => resetPipeline()}
        />
      )}

      {/* Error toast */}
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
    </div>
  );
}
