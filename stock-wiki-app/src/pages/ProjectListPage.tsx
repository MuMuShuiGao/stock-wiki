import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";

export default function ProjectListPage() {
  const navigate = useNavigate();
  const {
    workspace,
    projects,
    error,
    refreshWorkspace,
    selectWorkspace,
    refreshProjects,
    createProject,
    deleteProject,
  } = useAppStore();

  const [newProjectName, setNewProjectName] = useState("");

  useEffect(() => {
    refreshWorkspace().then(() => {
      const ws = useAppStore.getState().workspace;
      if (ws) refreshProjects();
    });
  }, []);

  async function handleSelectWorkspace() {
    await selectWorkspace();
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    await createProject(name);
    setNewProjectName("");
  }

  function handleProjectClick(projectName: string) {
    navigate(`/project/${encodeURIComponent(projectName)}`);
  }

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <h1 className="text-2xl font-bold">stock-wiki</h1>
        <p className="text-[var(--color-text-secondary)]">
          Select a workspace folder to get started.
        </p>
        <button
          onClick={handleSelectWorkspace}
          className="px-6 py-2.5 rounded-lg bg-[var(--color-accent)] text-white font-medium
                     hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer"
        >
          Select Workspace
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full max-w-2xl mx-auto gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-1 truncate max-w-md">
            {workspace}
          </p>
        </div>
        <Link
          to="/settings"
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
        >
          Settings
        </Link>
      </div>

      {/* Create new project */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
          placeholder="New project name (e.g. AAPL, 宏观-利率)..."
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)]
                     bg-[var(--color-bg-secondary)] text-[var(--color-text)]
                     outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
        <button
          onClick={handleCreateProject}
          disabled={!newProjectName.trim()}
          className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white font-medium
                     hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create
        </button>
      </div>

      {/* Project list */}
      {projects.length === 0 ? (
        <p className="text-center text-[var(--color-text-muted)] py-8">
          No projects yet. Create one above.
        </p>
      ) : (
        <div className="grid gap-2">
          {projects.map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--color-border)]
                         hover:bg-[var(--color-bg-tertiary)] transition-colors group"
            >
              <span
                className="flex-1 flex items-center gap-3 cursor-pointer"
                onClick={() => handleProjectClick(p.name)}
              >
                <span className="text-lg">📁</span>
                <span className="font-medium">{p.name}</span>
              </span>
              <button
                onClick={async () => {
                  if (confirm(`Delete project "${p.name}"? This cannot be undone.`)) {
                    await deleteProject(p.name);
                  }
                }}
                className="text-xs px-2 py-1 rounded text-[var(--color-text-muted)]
                           hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-tertiary)]
                           opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
          <button className="ml-2 underline" onClick={() => useAppStore.getState().setError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
