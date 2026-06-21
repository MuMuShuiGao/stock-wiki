import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAppStore } from "../stores/appStore";

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
  } = useAppStore();

  const [newItemName, setNewItemName] = useState("");
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);

  // Compute current directory path from workspace + project name
  const projectDir = workspace
    ? `${workspace}\\${decodedName}`
    : "";

  useEffect(() => {
    if (projectDir) {
      refreshFiles(projectDir);
    }
  }, [projectDir]);

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

  // Determine if the selected file is a Markdown file
  const isMarkdown = selectedFile?.name.endsWith(".md") || selectedFile?.name.endsWith(".mdx");

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-sidebar)]
                        flex flex-col">
        {/* Project header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <Link
            to="/"
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
          >
            ← Projects
          </Link>
          <span className="font-semibold text-sm truncate">{decodedName}</span>
        </div>

        {/* File tree */}
        <div className="flex-1 overflow-y-auto p-2">
          {files.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] p-2">
              Empty project. Create a file or folder to start.
            </p>
          ) : (
            files.map((entry) => (
              <div
                key={entry.path}
                onClick={() => handleFileClick(entry)}
                className={`file-tree-item flex items-center gap-2 px-2 py-1.5 rounded text-sm
                  ${selectedFile?.path === entry.path ? "selected" : ""}`}
              >
                <span className="text-sm">{entry.is_dir ? "📁" : "📄"}</span>
                <span className="truncate">{entry.name}</span>
              </div>
            ))
          )}
        </div>

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
              <span className="text-sm font-medium truncate">{selectedFile.name}</span>
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
                  <div className="flex-1 border-r border-[var(--color-border)] bg-[var(--color-editor-bg)]">
                    <textarea
                      value={fileContent}
                      onChange={(e) => setFileContent(e.target.value)}
                      className="w-full h-full p-4 resize-none outline-none font-mono text-sm
                                 bg-transparent text-[var(--color-text)] leading-relaxed"
                      placeholder="Start writing..."
                    />
                  </div>
                  {/* Preview pane */}
                  <div className="flex-1 overflow-y-auto p-4 bg-[var(--color-preview-bg)] markdown-preview">
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">
                      Preview (react-markdown — will be wired up)
                    </p>
                    <pre className="whitespace-pre-wrap font-sans text-sm text-[var(--color-text)]">
                      {fileContent || "(empty)"}
                    </pre>
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
                <div className="flex-1 overflow-y-auto p-4 markdown-preview">
                  {isMarkdown ? (
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">
                      Preview mode (react-markdown to be wired)
                    </p>
                  ) : null}
                  <pre className="whitespace-pre-wrap font-sans text-sm text-[var(--color-text)]">
                    {fileContent || "(empty)"}
                  </pre>
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

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20
                        text-red-600 dark:text-red-400 text-sm shadow-lg max-w-md">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
