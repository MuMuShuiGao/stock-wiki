import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  LlmConfig,
  PreAnalysisEntity,
} from "../services/llm";
import {
  runPreAnalysis,
  generateWiki,
  getLlmConfig,
} from "../services/llm";

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export type PipelineStatus =
  | "idle"
  | "extracting"
  | "pre_analyzing"
  | "awaiting_confirmation"
  | "generating"
  | "done"
  | "error";

interface AppState {
  // ── Workspace ──
  workspace: string | null;
  setWorkspace: (ws: string | null) => void;

  // ── LLM Config ──
  llmConfig: LlmConfig | null;
  setLlmConfig: (c: LlmConfig | null) => void;

  // ── Projects ──
  projects: FileEntry[];
  setProjects: (p: FileEntry[]) => void;

  // ── Current project ──
  currentProject: string | null;
  setCurrentProject: (name: string | null) => void;

  // ── File tree ──
  files: FileEntry[];
  setFiles: (f: FileEntry[]) => void;

  // ── Selected file ──
  selectedFile: FileEntry | null;
  setSelectedFile: (f: FileEntry | null) => void;

  // ── File content ──
  fileContent: string;
  setFileContent: (c: string) => void;

  // ── Editing mode ──
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;

  // ── Loading states ──
  loading: boolean;
  setLoading: (v: boolean) => void;

  // ── Error ──
  error: string | null;
  setError: (e: string | null) => void;

  // ── LLM Pipeline ──
  pipelineStatus: PipelineStatus;
  setPipelineStatus: (s: PipelineStatus) => void;

  extractedText: string;
  setExtractedText: (t: string) => void;

  preAnalysisEntities: PreAnalysisEntity[];
  setPreAnalysisEntities: (e: PreAnalysisEntity[]) => void;

  sourceFilePath: string | null;
  setSourceFilePath: (p: string | null) => void;

  // ── Actions: Workspace ──
  refreshWorkspace: () => Promise<void>;
  selectWorkspace: () => Promise<void>;

  // ── Actions: LLM Config ──
  refreshLlmConfig: () => Promise<void>;

  // ── Actions: Projects ──
  refreshProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  deleteProject: (name: string) => Promise<void>;
  renameProject: (oldName: string, newName: string) => Promise<void>;

  // ── Actions: Files ──
  refreshFiles: (dirPath: string) => Promise<void>;
  createFile: (parentDir: string, name: string, content?: string) => Promise<void>;
  createFolder: (parentDir: string, name: string) => Promise<void>;
  readFile: (filePath: string) => Promise<void>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  deleteFile: (filePath: string) => Promise<void>;
  renameFile: (filePath: string, newName: string) => Promise<void>;
  moveFile: (source: string, destDir: string) => Promise<void>;

  importFiles: (sourcePath: string, destDir: string) => Promise<void>;
  // ── Actions: LLM Pipeline ──
  extractText: (filePath: string) => Promise<void>;
  startPreAnalysis: (projectName: string, filePath: string) => Promise<void>;
  confirmAndGenerate: (
    projectName: string,
    sourceText: string,
    entities: PreAnalysisEntity[],
  ) => Promise<void>;
  resetPipeline: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ── Initial state ──
  workspace: null,
  setWorkspace: (ws) => set({ workspace: ws }),
  llmConfig: null,
  setLlmConfig: (c) => set({ llmConfig: c }),
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

  // Pipeline state
  pipelineStatus: "idle",
  setPipelineStatus: (s) => set({ pipelineStatus: s }),
  extractedText: "",
  setExtractedText: (t) => set({ extractedText: t }),
  preAnalysisEntities: [],
  setPreAnalysisEntities: (e) => set({ preAnalysisEntities: e }),
  sourceFilePath: null,
  setSourceFilePath: (p) => set({ sourceFilePath: p }),

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
        await get().refreshProjects();
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ── LLM Config ──
  refreshLlmConfig: async () => {
    try {
      const config: LlmConfig = await getLlmConfig();
      set({ llmConfig: config });
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

  importFiles: async (sourcePath: string, destDir: string) => {
    await invoke("import_file", { sourcePath, destDir });
  },
  // ── LLM Pipeline ──
  extractText: async (filePath: string) => {
    set({ pipelineStatus: "extracting", error: null });
    try {
      const text: string = await invoke("extract_text", { filePath });
      set({ extractedText: text, sourceFilePath: filePath });
    } catch (e) {
      set({ error: String(e), pipelineStatus: "error" });
    }
  },

  startPreAnalysis: async (projectName: string, filePath: string) => {
    // Step 1: Extract text
    set({ pipelineStatus: "extracting", error: null });
    try {
      const text: string = await invoke("extract_text", { filePath });
      set({ extractedText: text, sourceFilePath: filePath });
    } catch (e) {
      set({ error: String(e), pipelineStatus: "error" });
      return;
    }

    // Step 2: Pre-analysis via LLM
    set({ pipelineStatus: "pre_analyzing" });
    try {
      const entities = await runPreAnalysis(get().extractedText);

      // Step 3: Check existence for each entity
      for (const entity of entities) {
        try {
          const existingPath: string | null = await invoke("check_wiki_exists", {
            projectName,
            wikiType: entity.type,
            title: entity.title,
          });
          if (existingPath) {
            entity.action = "update";
            entity.existing_path = existingPath;
          } else {
            entity.action = "create";
          }
        } catch {
          entity.action = "create";
        }
      }

      set({ preAnalysisEntities: entities, pipelineStatus: "awaiting_confirmation" });
    } catch (e) {
      set({ error: String(e), pipelineStatus: "error" });
    }
  },

  confirmAndGenerate: async (
    projectName: string,
    sourceText: string,
    entities: PreAnalysisEntity[],
  ) => {
    set({ pipelineStatus: "generating", error: null });
    const errors: string[] = [];
    let succeeded = 0;

    for (const entity of entities) {
      try {
        let existingContent: string | undefined;
        if (entity.action === "update" && entity.existing_path) {
          try {
            existingContent = await invoke("read_wiki", {
              filePath: entity.existing_path,
            });
          } catch {
            // If read fails, treat as create
            entity.action = "create";
          }
        }

        const wikiContent = await generateWiki(entity, sourceText, existingContent);

        await invoke("write_wiki", {
          projectName,
          wikiType: entity.type,
          title: entity.title,
          content: wikiContent,
        });

        succeeded++;
      } catch (e) {
        errors.push(`${entity.title}: ${String(e)}`);
      }
    }

    // Refresh file tree
    const ws = get().workspace;
    if (ws) {
      const projectDir = `${ws}\\${projectName}`;
      try {
        await get().refreshFiles(projectDir);
      } catch { /* refresh is best-effort */ }
    }

    if (errors.length > 0 && succeeded === 0) {
      set({
        error: `所有 ${errors.length} 个 Wiki 生成失败:\n${errors.join("\n")}`,
        pipelineStatus: "error",
      });
    } else if (errors.length > 0) {
      set({
        error: `${succeeded}/${entities.length} 个成功，${errors.length} 个失败:\n${errors.join("\n")}`,
        pipelineStatus: "done",
      });
    } else {
      set({ pipelineStatus: "done" });
    }
  },

  resetPipeline: () => {
    set({
      pipelineStatus: "idle",
      extractedText: "",
      preAnalysisEntities: [],
      sourceFilePath: null,
      error: null,
    });
  },
}));
