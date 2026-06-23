import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { LlmConfig } from "../services/llm";
import { getLlmConfig } from "../services/llm";
import { logInfo, logWarn, logError } from "../services/logger";
import {
  runStage1Analysis,
  runStage2Planning,
  batchUpdateWikiPages,
  batchCreateWikiPages,
  writeLogMd,
  appendWikiIndex,
  extractAnalysisSummary,
  extractSummaryFromFrontmatter,
  initialPipelineState,
  type PlannedPage,
  type IngestPlan,
  type BatchWriteResult,
  type StageProgress,
  type PipelineState,
} from "../services/ingest";
import { rebuildWikilinks, type WikilinksData } from "../services/wikilinks";

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface BatchFileStatus {
  path: string;
  name: string;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
}

export interface BatchProgress {
  files: BatchFileStatus[];
  running: boolean;
}

interface AppState {
  // ── Workspace ──
  workspace: string | null;
  setWorkspace: (ws: string | null) => void;

  // ── LLM Config ──
  llmConfig: LlmConfig | null;
  setLlmConfig: (c: LlmConfig | null) => void;

  // ── Theme ──
  themePreference: "dark" | "light" | "system";
  setThemePreference: (t: "dark" | "light" | "system") => void;

  // ── Last visited project (preserved across route changes) ──
  lastVisitedProject: string | null;
  setLastVisitedProject: (name: string | null) => void;

  // ── Projects ──
  projects: FileEntry[];
  setProjects: (p: FileEntry[]) => void;

  // ── Selected file ──
  selectedFile: FileEntry | null;
  setSelectedFile: (f: FileEntry | null) => void;

  // ── File content ──
  fileContent: string;
  setFileContent: (c: string) => void;

  // ── Editing mode ──
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;

  // ── Error ──
  error: string | null;
  setError: (e: string | null) => void;

  // ── LLM Pipeline ──
  pipelineState: PipelineState;
  setPipelineState: (patch: Partial<PipelineState>) => void;

  // ── Knowledge Graph ──
  graphData: WikilinksData | null;
  graphLoading: boolean;
  setGraphData: (data: WikilinksData | null) => void;
  setGraphLoading: (v: boolean) => void;

  // ── Batch Ingest ──
  batchProgress: BatchProgress | null;
  setBatchProgress: (p: BatchProgress | null) => void;

  // ── Actions: Workspace ──
  refreshWorkspace: () => Promise<void>;
  selectWorkspace: () => Promise<void>;

  // ── Actions: LLM Config ──
  refreshLlmConfig: () => Promise<void>;

  // ── Actions: Projects ──
  refreshProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  deleteProject: (name: string) => Promise<void>;

  // ── Actions: Files ──
  readFile: (filePath: string) => Promise<void>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  deleteFile: (filePath: string) => Promise<void>;

  importFiles: (sourcePath: string, destDir: string) => Promise<void>;
  // ── Actions: LLM Pipeline ──
  /** 执行 Stage 1+2：提取文本、分析、规划，停在 awaiting_confirmation */
  runIngestPipeline: (projectName: string, filePath: string) => Promise<void>;
  /** 用户确认计划后执行 Stage 3+4+housekeeping */
  confirmPlan: (projectName: string, plan: IngestPlan) => Promise<void>;
  /** 重置管道 */
  resetPipeline: () => void;

  /** 批量摄入：遍历 raw/ 下多个文件，自动确认计划，完成后统一重建图谱 */
  runBatchIngestPipeline: (projectName: string, filePaths: string[]) => Promise<void>;
}

/** 从完整路径提取文件名（兼容 Windows / Unix 分隔符） */
function basename(filePath: string): string {
  return filePath.split("\\").pop() || filePath.split("/").pop() || filePath;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ── Initial state ──
  workspace: null,
  setWorkspace: (ws) => set({ workspace: ws }),
  llmConfig: null,
  setLlmConfig: (c) => set({ llmConfig: c }),
  themePreference: (localStorage.getItem("stock-wiki-theme") as "dark" | "light" | "system") || "system",
  setThemePreference: (t) => {
    localStorage.setItem("stock-wiki-theme", t);
    set({ themePreference: t });
  },
  lastVisitedProject: null,
  setLastVisitedProject: (name) => set({ lastVisitedProject: name }),
  projects: [],
  setProjects: (p) => set({ projects: p }),
  selectedFile: null,
  setSelectedFile: (f) => set({ selectedFile: f }),
  fileContent: "",
  setFileContent: (c) => set({ fileContent: c }),
  isEditing: false,
  setIsEditing: (v) => set({ isEditing: v }),
  error: null,
  setError: (e) => set({ error: e }),

  // Pipeline state
  pipelineState: initialPipelineState(),
  setPipelineState: (patch) =>
    set((prev) => ({
      pipelineState: { ...prev.pipelineState, ...patch },
    })),

  // Knowledge Graph
  graphData: null,
  graphLoading: false,
  setGraphData: (data) => set({ graphData: data }),
  setGraphLoading: (v) => set({ graphLoading: v }),

  // Batch Ingest
  batchProgress: null,
  setBatchProgress: (p) => set({ batchProgress: p }),

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

  // ── Files ──
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
    } catch (e) {
      set({ error: String(e) });
    }
  },

  importFiles: async (sourcePath: string, destDir: string) => {
    try {
      await invoke("import_file", { sourcePath, destDir });
    } catch (e) {
      set({ error: String(e) });
    }
  },
  // ── LLM Pipeline ──

  /** Stage 1+2：提取文本 → 分析 → 规划，停在 awaiting_confirmation */
  runIngestPipeline: async (projectName: string, filePath: string, opts?: { autoConfirm?: boolean }) => {
    logInfo("Pipeline", `启动: 项目=${projectName} 文件=${filePath}`);

    const tick = get().setPipelineState;

    // ── 检查是否已摄入 ──
    const fileName = basename(filePath);
    try {
      const alreadyIngested: boolean = await invoke("check_ingested", {
        projectName,
        fileName,
      });
      if (alreadyIngested) {
        logWarn("Pipeline", `文件已摄入，跳过: ${fileName}`);
        tick({
          status: "error",
          error: `文件 "${fileName}" 已经生成过 Wiki，不允许重复摄入。`,
        });
        return;
      }
    } catch (e) {
      logError("Pipeline", `检查摄入状态失败: ${String(e)}`);
      tick({ status: "error", error: `检查摄入状态失败: ${String(e)}` });
      return;
    }

    // ── 提取文本 ──
    logInfo("Pipeline", "阶段: 提取文本");
    tick({ status: "extracting", error: null });
    let text: string;
    try {
      text = await invoke("extract_text", { filePath });
      logInfo("Pipeline", `文本提取完成: ${text.length} 字符`);
      tick({ extractedText: text, sourceFilePath: filePath });
    } catch (e) {
      logError("Pipeline", `文本提取失败: ${String(e)}`);
      tick({ status: "error", error: String(e) });
      return;
    }

    // ── 读取 wiki/index.md ──
    let indexContent = "";
    try {
      const ws = get().workspace;
      if (ws) {
        const indexPath = `${ws}\\${projectName}\\wiki\\index.md`;
        indexContent = await invoke("read_file", { filePath: indexPath });
        logInfo("Pipeline", `已读取索引: ${indexContent.length} 字符`);
      }
    } catch {
      logInfo("Pipeline", "索引不存在（首次 ingest，正常）");
    }
    tick({ indexContent });

    // ── Stage 1: 分析源文档 ──
    logInfo("Pipeline", "阶段: Stage 1 分析");
    tick({ status: "analyzing" });
    let analysisText: string;
    try {
      analysisText = await runStage1Analysis(text, indexContent);
      tick({ analysisText });
    } catch (e) {
      logError("Pipeline", `Stage 1 失败: ${String(e)}`);
      tick({ status: "error", error: String(e) });
      return;
    }

    // ── Stage 2: 规划变更 ──
    logInfo("Pipeline", "阶段: Stage 2 规划");
    tick({ status: "planning" });
    try {
      const sourceFileName = basename(filePath);
      let plan = await runStage2Planning(analysisText, indexContent, sourceFileName);
      plan.analysisSummary = extractAnalysisSummary(analysisText);

      // 补全 update 页面的 existing_path，确认不存在的降级为 create
      const ws = get().workspace;
      if (!ws) {
        logError("Pipeline", "工作区未配置");
        tick({ status: "error", error: "工作区未配置" });
        return;
      }
      const confirmedUpdate: PlannedPage[] = [];
      for (const page of plan.update) {
        try {
          const existingPath: string | null = await invoke("check_wiki_exists", {
            projectName,
            wikiType: page.type,
            title: page.title,
          });
          if (existingPath) {
            page.existing_path = existingPath;
            confirmedUpdate.push(page);
          } else {
            page.action = "create";
            page.existing_path = undefined;
            plan.create.push(page);
          }
        } catch {
          page.action = "create";
          plan.create.push(page);
        }
      }
      plan.update = confirmedUpdate;

      logInfo("Pipeline", `Stage 2 完成: create=${plan.create.length} update=${plan.update.length}`);
      if (opts?.autoConfirm) {
        await get().confirmPlan(projectName, plan, { skipWikilinksRebuild: true });
      } else {
        tick({ plan, status: "awaiting_confirmation" });
      }
    } catch (e) {
      logError("Pipeline", `Stage 2 失败: ${String(e)}`);
      tick({ status: "error", error: String(e) });
    }
  },

  /** Stage 3+4+housekeeping */
  confirmPlan: async (projectName: string, plan: IngestPlan, opts?: { skipWikilinksRebuild?: boolean }) => {
    logInfo("Pipeline", `用户确认计划: create=${plan.create.length} update=${plan.update.length}`);

    const tick = get().setPipelineState;
    const state = get().pipelineState;

    const errors: string[] = [];

    /** 执行批量写入，失败时逐页重试（利用 writtenKeys 跳过已写入页面） */
    async function executeBatchWithRetry(
      pages: PlannedPage[],
      progressKey: "updateProgress" | "createProgress",
      batchFn: (batch: PlannedPage[]) => Promise<BatchWriteResult>,
      singleFn: (page: PlannedPage) => Promise<BatchWriteResult>,
      progress: StageProgress,
      label: string,
    ): Promise<void> {
      async function retryEach(list: PlannedPage[]) {
        for (const page of list) {
          logInfo("Pipeline", `${label}: 逐页重试 ${page.title}`);
          tick({ [progressKey]: { ...progress, currentTitle: page.title } });
          try {
            const r = await singleFn(page);
            if (r.allWritten) {
              progress.completed++;
            } else {
              progress.failed++;
              progress.errors.push({
                title: page.title,
                error: "LLM 未生成有效内容或磁盘写入失败",
              });
            }
          } catch (e2) {
            progress.failed++;
            progress.errors.push({ title: page.title, error: String(e2) });
          }
          tick({ [progressKey]: { ...progress } });
        }
      }

      logInfo("Pipeline", `${label}: 批量写入 ${pages.length} 页`);
      try {
        const result = await batchFn(pages);
        progress.completed = result.writtenKeys.size;

        if (!result.allWritten) {
          const toRetry = pages.filter(
            (p) => !result.writtenKeys.has(`${p.type}/${p.title}`),
          );
          logInfo("Pipeline", `${label}: 批量完成 ${result.writtenKeys.size}/${pages.length}, 重试 ${toRetry.length} 页`);
          await retryEach(toRetry);
        }
      } catch (e) {
        logWarn("Pipeline", `${label}: 批量请求整体失败, 全部逐页重试: ${String(e)}`);
        await retryEach(pages);
      }
      logInfo("Pipeline", `${label}: 完成=${progress.completed} 失败=${progress.failed}`);
      tick({ [progressKey]: { ...progress } });
    }

    const sourceFileName = state.sourceFilePath
      ? basename(state.sourceFilePath)
      : "未知文件";

    const allPages = [...plan.create, ...plan.update];

    // ── Stage 3: 更新已有页面 ──
    if (plan.update.length > 0) {
      logInfo("Pipeline", "阶段: Stage 3 更新已有页面");
      const progress: StageProgress = {
        total: plan.update.length,
        completed: 0,
        failed: 0,
        currentTitle: null,
        errors: [],
      };
      tick({ status: "updating", updateProgress: { ...progress } });

      // 先收集所有已有内容
      const existingContents: Record<string, string> = {};
      for (const page of plan.update) {
        const key = `${page.type}/${page.title}`;
        if (page.existing_path) {
          try {
            existingContents[key] = await invoke("read_wiki", {
              filePath: page.existing_path,
            });
          } catch {
            existingContents[key] = "";
          }
        } else {
          existingContents[key] = "";
        }
      }
      logInfo("Pipeline", `Stage 3: 已读取 ${Object.keys(existingContents).length} 个已有页面内容`);

      await executeBatchWithRetry(
        plan.update,
        "updateProgress",
        (batch) =>
          batchUpdateWikiPages(
            batch,
            existingContents,
            state.analysisText,
            sourceFileName,
            projectName,
            state.indexContent,
            allPages,
          ),
        (page) => {
          const key = `${page.type}/${page.title}`;
          return batchUpdateWikiPages(
            [page],
            { [key]: existingContents[key] || "" },
            state.analysisText,
            sourceFileName,
            projectName,
            state.indexContent,
            allPages,
          );
        },
        progress,
        "Stage 3",
      );

      if (progress.failed > 0) {
        errors.push(
          ...progress.errors.map(
            (e) => `更新失败: ${e.title} — ${e.error}`,
          ),
        );
      }
    }

    // ── Stage 4: 新建页面 ──
    if (plan.create.length > 0) {
      logInfo("Pipeline", "阶段: Stage 4 新建页面");
      const progress: StageProgress = {
        total: plan.create.length,
        completed: 0,
        failed: 0,
        currentTitle: null,
        errors: [],
      };
      tick({ status: "creating", createProgress: { ...progress } });

      await executeBatchWithRetry(
        plan.create,
        "createProgress",
        (batch) =>
          batchCreateWikiPages(batch, state.analysisText, sourceFileName, projectName, state.indexContent, allPages),
        (page) =>
          batchCreateWikiPages([page], state.analysisText, sourceFileName, projectName, state.indexContent, allPages),
        progress,
        "Stage 4",
      );

      if (progress.failed > 0) {
        errors.push(
          ...progress.errors.map(
            (e) => `新建失败: ${e.title} — ${e.error}`,
          ),
        );
      }
    }

    // ── Housekeeping ──
    logInfo("Pipeline", "阶段: Housekeeping");
    tick({ status: "housekeeping" });

    const ws = get().workspace;

    // 为新建页面逐条追加 index 条目，summary 从 frontmatter 读取
    for (const page of plan.create) {
      try {
        let summary = page.rationale || "";
        // 读回已写入的页面，从 frontmatter 取 50-120 字 summary
        if (ws) {
          try {
            const filePath = `${ws}\\${projectName}\\wiki\\${page.type}\\${page.title}.md`;
            const content: string = await invoke("read_file", { filePath });
            const fmSummary = extractSummaryFromFrontmatter(content);
            if (fmSummary) summary = fmSummary;
          } catch {
            // 读文件失败，用 rationale 兜底
          }
        }
        await appendWikiIndex(projectName, page.type, page.title, summary);
      } catch (e) {
        errors.push(`index 追加失败: ${page.title} — ${String(e)}`);
      }
    }
    try {
      const sourceFileName = state.sourceFilePath
        ? basename(state.sourceFilePath)
        : "未知文件";
      await writeLogMd(projectName, sourceFileName, plan);
    } catch (e) {
      errors.push(`log 写入失败: ${String(e)}`);
    }

    // ── 重建知识图谱索引 ──（批量模式推迟到最后统一重建）
    if (!opts?.skipWikilinksRebuild) {
      logInfo("Pipeline", "阶段: 重建知识图谱链接");
      try {
        await rebuildWikilinks(projectName);
        logInfo("Pipeline", "知识图谱链接重建完成");
      } catch (e) {
        logWarn("Pipeline", `知识图谱重建失败: ${String(e)}`);
        // 非致命：图谱重建失败不阻塞 pipeline 完成
      }
    }

    // ── 移动源文件到 ingested ──
    // 仅在完全成功时移动（部分失败不移动）
    if (errors.length === 0 && state.sourceFilePath) {
      logInfo("Pipeline", "阶段: 移动源文件到 ingested");
      try {
        await invoke("move_to_ingested", {
          projectName,
          sourcePath: state.sourceFilePath,
        });
        logInfo("Pipeline", `源文件已移动到 ingested: ${basename(state.sourceFilePath)}`);
      } catch (e) {
        logWarn("Pipeline", `移动源文件失败（非致命）: ${String(e)}`);
      }
    }

    // ── 完成 ──
    if (errors.length > 0) {
      const allUpdateFailed =
        plan.update.length > 0 &&
        get().pipelineState.updateProgress.failed === plan.update.length;
      const allCreateFailed =
        plan.create.length > 0 &&
        get().pipelineState.createProgress.failed === plan.create.length;

      if (allUpdateFailed && allCreateFailed) {
        logError("Pipeline", `全部失败:\n${errors.join("\n")}`);
        tick({
          status: "error",
          error: `所有操作失败:\n${errors.join("\n")}`,
        });
      } else {
        logWarn("Pipeline", `部分完成:\n${errors.join("\n")}`);
        tick({
          status: "done",
          error: `部分成功:\n${errors.join("\n")}`,
        });
      }
    } else {
      logInfo("Pipeline", "全部完成!");
      tick({ status: "done" });
    }
  },

  resetPipeline: () => {
    set({ pipelineState: initialPipelineState() });
  },

  runBatchIngestPipeline: async (projectName: string, filePaths: string[]) => {
    logInfo("Batch", `批量摄入启动: ${filePaths.length} 个文件`);

    const files: BatchFileStatus[] = filePaths.map((p) => ({
      path: p,
      name: basename(p),
      status: "pending" as const,
    }));
    get().setBatchProgress({ files, running: true });

    const ws = get().workspace;
    if (!ws) {
      set({ batchProgress: { files, running: false }, error: "工作区未配置" });
      return;
    }

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      files[i] = { ...f, status: "processing" };
      get().setBatchProgress({ files: [...files], running: true });

      try {
        await get().runIngestPipeline(projectName, f.path, { autoConfirm: true });

        const finalStatus = get().pipelineState.status;
        if (finalStatus === "error") {
          throw new Error(get().pipelineState.error || "摄入失败");
        }

        files[i] = { ...f, status: "done" };
        logInfo("Batch", `完成 ${i + 1}/${files.length}: ${f.name}`);
      } catch (e) {
        files[i] = {
          ...f,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        };
        logError("Batch", `失败 ${i + 1}/${files.length}: ${f.name} — ${files[i].error}`);
      }

      get().setBatchProgress({ files: [...files], running: true });
    }

    // ── 统一重建知识图谱 ──
    logInfo("Batch", "阶段: 统一重建知识图谱链接");
    try {
      await rebuildWikilinks(projectName);
      logInfo("Batch", "知识图谱链接重建完成");
    } catch (e) {
      logWarn("Batch", `知识图谱重建失败: ${String(e)}`);
    }

    get().setBatchProgress({ files, running: false });
    logInfo("Batch", `批量摄入完成: 成功=${files.filter((f) => f.status === "done").length} 失败=${files.filter((f) => f.status === "error").length}`);

    get().resetPipeline();
  },
}));
