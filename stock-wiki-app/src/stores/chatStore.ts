import { create } from "zustand";
import {
  searchWiki,
  generateAnswer,
  listConversations,
  createConversation,
  getConversation,
  saveConversation,
  deleteConversation,
  type ConversationMeta,
  type Conversation,
  type ChatMessage,
} from "../services/chat";
import { logError } from "../services/logger";

// ── State ──────────────────────────────────────────────────────────

interface ChatState {
  // ── 对话列表 ──
  conversations: ConversationMeta[];
  currentConvId: string | null;
  messages: ChatMessage[];

  // ── 加载状态 ──
  isSearching: boolean;
  isGenerating: boolean;
  error: string | null;

  // ── 项目上下文 ──
  projectName: string | null;

  // ── Actions ──
  setProject: (name: string | null) => void;
  loadConversations: () => Promise<void>;
  newConversation: () => Promise<void>;
  selectConversation: (convId: string) => Promise<void>;
  removeConversation: (convId: string) => Promise<void>;
  sendMessage: (query: string) => Promise<void>;
  clearError: () => void;
}

// ── Auto-title ─────────────────────────────────────────────────────

/** 从用户第一条消息中截取对话标题 */
function autoTitle(query: string): string {
  const trimmed = query.trim();
  // 取前 20 个中文字符
  const chars = [...trimmed];
  let count = 0;
  const title: string[] = [];
  for (const c of chars) {
    title.push(c);
    count++;
    if (count >= 20) break;
  }
  return title.join("") + (chars.length > 20 ? "…" : "");
}

// ── Store ──────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConvId: null,
  messages: [],
  isSearching: false,
  isGenerating: false,
  error: null,
  projectName: null,

  /** 切换项目时调用，重置所有状态并加载新项目的对话列表 */
  setProject: (name: string | null) => {
    set({
      projectName: name,
      conversations: [],
      currentConvId: null,
      messages: [],
      isSearching: false,
      isGenerating: false,
      error: null,
    });
    if (name) {
      get().loadConversations();
    }
  },

  /** 加载当前项目的对话列表 */
  loadConversations: async () => {
    const { projectName } = get();
    if (!projectName) return;
    try {
      const list = await listConversations(projectName);
      set({ conversations: list });
    } catch (err) {
      logError("chat", `加载对话列表失败: ${err}`);
    }
  },

  /** 创建新对话 */
  newConversation: async () => {
    const { projectName } = get();
    if (!projectName) return;
    try {
      const conv = await createConversation(projectName, "新对话");
      set({
        currentConvId: conv.id,
        messages: [],
        error: null,
      });
      await get().loadConversations();
    } catch (err) {
      logError("chat", `创建对话失败: ${err}`);
      set({ error: `创建对话失败: ${err}` });
    }
  },

  /** 选中已有对话，加载消息历史 */
  selectConversation: async (convId: string) => {
    const { projectName } = get();
    if (!projectName) return;
    try {
      const conv = await getConversation(projectName, convId);
      set({
        currentConvId: conv.id,
        messages: conv.messages,
        error: null,
      });
    } catch (err) {
      logError("chat", `加载对话失败: ${err}`);
      set({ error: `加载对话失败: ${err}` });
    }
  },

  /** 删除对话 */
  removeConversation: async (convId: string) => {
    const { projectName, currentConvId } = get();
    if (!projectName) return;
    try {
      await deleteConversation(projectName, convId);
      if (currentConvId === convId) {
        set({ currentConvId: null, messages: [] });
      }
      await get().loadConversations();
    } catch (err) {
      logError("chat", `删除对话失败: ${err}`);
      set({ error: `删除对话失败: ${err}` });
    }
  },

  /** 发送消息：检索 → LLM 生成 → 保存 */
  sendMessage: async (query: string) => {
    const { projectName, currentConvId, messages } = get();
    if (!projectName || !query.trim()) return;

    // 没有当前对话则自动创建
    let convId = currentConvId;
    if (!convId) {
      try {
        const conv = await createConversation(projectName, autoTitle(query));
        convId = conv.id;
        set({ currentConvId: conv.id });
        await get().loadConversations();
      } catch (err) {
        logError("chat", `自动创建对话失败: ${err}`);
        set({ error: `创建对话失败: ${err}` });
        return;
      }
    }

    // 1. 添加用户消息
    const userMsg: ChatMessage = { role: "user", content: query, references: [] };
    const updatedMessages = [...messages, userMsg];
    set({ messages: updatedMessages, isSearching: true, error: null });

    // 2. 检索（在生成前就更新搜索结果以展示引用预加载）
    try {
      await searchWiki(projectName, query);
      set({ isSearching: false, isGenerating: true });
    } catch (err) {
      logError("chat", `检索失败: ${err}`);
      set({ isSearching: false, error: `检索失败: ${err}` });
      return;
    }

    // 3. 生成回答
    try {
      const assistantMsg = await generateAnswer(projectName, query, updatedMessages);
      const finalMessages = [...updatedMessages, assistantMsg];
      set({
        messages: finalMessages,
        isGenerating: false,
      });

      // 4. 持久化保存（后台）
      const title = messages.length === 0 ? autoTitle(query) : undefined;
      await saveConversation(projectName, convId!, finalMessages, title);
      await get().loadConversations();
    } catch (err) {
      logError("chat", `生成回答失败: ${err}`);
      set({ isGenerating: false, error: `生成回答失败: ${err}` });
    }
  },

  clearError: () => set({ error: null }),
}));
