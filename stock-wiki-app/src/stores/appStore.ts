import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface AppState {
  // Workspace
  workspace: string | null;
  setWorkspace: (ws: string | null) => void;

  // Projects
  projects: FileEntry[];
  setProjects: (p: FileEntry[]) => void;

  // Current project
  currentProject: string | null;
  setCurrentProject: (name: string | null) => void;

  // File tree
  files: FileEntry[];
  setFiles: (f: FileEntry[]) => void;

  // Selected file
  selectedFile: FileEntry | null;
  setSelectedFile: (f: FileEntry | null) => void;

  // File content
  fileContent: string;
  setFileContent: (c: string) => void;

  // Editing mode
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;

  // Loading states
  loading: boolean;
  setLoading: (v: boolean) => void;

  // Error
  error: string | null;
  setError: (e: string | null) => void;

  // ── Actions ──
  refreshWorkspace: () => Promise<void>;
  selectWorkspace: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  deleteProject: (name: string) => Promise<void>;
  renameProject: (oldName: string, newName: string) => Promise<void>;

  refreshFiles: (dirPath: string) => Promise<void>;
  createFile: (parentDir: string, name: string, content?: string) => Promise<void>;
  createFolder: (parentDir: string, name: string) => Promise<void>;
  readFile: (filePath: string) => Promise<void>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  deleteFile: (filePath: string) => Promise<void>;
  renameFile: (filePath: string, newName: string) => Promise<void>;
  moveFile: (source: string, destDir: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  workspace: null,
  setWorkspace: (ws) => set({ workspace: ws }),
  projects: [],
  setProjects: (p) => set({ projects: p }),
  currentProject: null,
  setCurrentProject: (name) => set({ currentProject: name }),
  files: [],
  setFiles: (f) => set({ files: f }),
  selectedFile: null,
  setSelectedFile: (f) => set({ selectedFile: f }),
  fileContent: "",
  setFileContent: (c) => set({ fileContent: c }),
  isEditing: false,
  setIsEditing: (v) => set({ isEditing: v }),
  loading: false,
  setLoading: (v) => set({ loading: v }),
  error: null,
  setError: (e) => set({ error: e }),

  // ── Workspace ──
  refreshWorkspace: async () => {
    try {
      const ws: string | null = await invoke("get_workspace");
      set({ workspace: ws });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectWorkspace: async () => {
    try {
      const ws: string | null = await invoke("select_workspace");
      if (ws) {
        set({ workspace: ws });
        // auto-refresh projects after selecting workspace
        await get().refreshProjects();
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ── Projects ──
  refreshProjects: async () => {
    try {
      const projects: FileEntry[] = await invoke("list_projects");
      set({ projects });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createProject: async (name: string) => {
    try {
      await invoke("create_project", { name });
      await get().refreshProjects();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteProject: async (name: string) => {
    try {
      await invoke("delete_project", { name });
      await get().refreshProjects();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameProject: async (oldName: string, newName: string) => {
    try {
      await invoke("rename_project", { oldName, newName });
      await get().refreshProjects();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ── Files ──
  refreshFiles: async (dirPath: string) => {
    try {
      const files: FileEntry[] = await invoke("list_directory", { dirPath });
      set({ files });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createFile: async (parentDir: string, name: string, content?: string) => {
    try {
      await invoke("create_file", { parentDir, name, content });
      await get().refreshFiles(parentDir);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createFolder: async (parentDir: string, name: string) => {
    try {
      await invoke("create_folder", { parentDir, name });
      await get().refreshFiles(parentDir);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  readFile: async (filePath: string) => {
    try {
      const content: string = await invoke("read_file", { filePath });
      set({ fileContent: content });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  writeFile: async (filePath: string, content: string) => {
    try {
      await invoke("write_file", { filePath, content });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteFile: async (filePath: string) => {
    try {
      await invoke("delete_file", { filePath });
      const parent = filePath.substring(0, filePath.lastIndexOf("\\"));
      await get().refreshFiles(parent || filePath);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameFile: async (filePath: string, newName: string) => {
    try {
      await invoke("rename_file", { filePath, newName });
      const parent = filePath.substring(0, filePath.lastIndexOf("\\"));
      await get().refreshFiles(parent);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  moveFile: async (source: string, destDir: string) => {
    try {
      await invoke("move_file", { source, destDir });
      const parent = source.substring(0, source.lastIndexOf("\\"));
      await get().refreshFiles(parent);
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
