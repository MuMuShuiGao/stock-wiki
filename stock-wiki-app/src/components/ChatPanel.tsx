import { useState, useRef, useEffect } from "react";
import { useChatStore } from "../stores/chatStore";

/** 格式化日期：MM-DD HH:mm */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export default function ChatPanel({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "main";
}) {
  const {
    conversations,
    currentConvId,
    messages,
    isSearching,
    isGenerating,
    error,
    sendMessage,
    newConversation,
    selectConversation,
    removeConversation,
    clearError,
  } = useChatStore();

  const isMain = variant === "main";
  const [expanded, setExpanded] = useState(isMain);
  const [input, setInput] = useState("");
  const [showConvList, setShowConvList] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 有新消息时自动滚动到底部
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // 展开时聚焦输入框
  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;
    const query = input.trim();
    setInput("");
    if (!isMain) setExpanded(true);
    await sendMessage(query);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConv = async () => {
    await newConversation();
    if (!isMain) {
      setShowConvList(false);
      setExpanded(true);
    }
  };

  const handleSelectConv = async (convId: string) => {
    await selectConversation(convId);
    if (!isMain) {
      setShowConvList(false);
      setExpanded(true);
    }
  };

  const handleDeleteConv = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    await removeConversation(convId);
  };

  const currentConv = conversations.find((c) => c.id === currentConvId);
  const sortedConvs = [...conversations].sort((a, b) => b.updated.localeCompare(a.updated));

  // ── 渲染：对话项 ──
  function renderConvItem(c: typeof conversations[number]) {
    const isActive = c.id === currentConvId;
    return (
      <div
        key={c.id}
        onClick={() => handleSelectConv(c.id)}
        className={`group relative px-3 py-2.5 cursor-pointer border-b border-[var(--color-border)]/40
          transition-colors
          ${isActive
            ? "bg-[var(--color-accent)]/10 border-l-[3px] border-l-[var(--color-accent)]"
            : "hover:bg-[var(--color-bg-tertiary)] border-l-[3px] border-l-transparent"
          }`}
      >
        <div className="text-xs font-medium text-[var(--color-text)] truncate pr-5 leading-snug">
          {c.title}
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
          {fmtDate(c.updated)}
        </div>
        {/* 删除按钮 — hover 时显示 */}
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2
                     w-4 h-4 flex items-center justify-center rounded
                     text-[10px] text-[var(--color-text-muted)]
                     opacity-0 group-hover:opacity-100
                     hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10
                     transition-opacity cursor-pointer"
          onClick={(e) => handleDeleteConv(e, c.id)}
          title="删除对话"
        >
          ×
        </button>
      </div>
    );
  }

  // ── 渲染：消息气泡 ──
  function renderMessage(msg: { role: string; content: string; references: string[] }, i: number) {
    return (
      <div
        key={i}
        className={`${msg.role === "user" ? "flex justify-end" : ""}`}
      >
        <div
          className={`rounded-lg px-3 py-2 leading-relaxed
            ${isMain ? "max-w-[72%] text-sm" : "max-w-[95%] text-xs"}
            ${msg.role === "user"
              ? "bg-[var(--color-accent)]/15 text-[var(--color-text)]"
              : "bg-[var(--color-editor-bg)] text-[var(--color-text)] border border-[var(--color-border)]"
            }`}
        >
          <div className="whitespace-pre-wrap break-words">{msg.content}</div>

          {msg.role === "assistant" && msg.references.length > 0 && (
            <div className="mt-2 pt-1.5 border-t border-[var(--color-border)]/50">
              <span className="text-[10px] text-[var(--color-text-muted)]">参考: </span>
              {msg.references.map((ref, j) => (
                <span key={j} className="text-[10px] text-[var(--color-accent)]/80">
                  [{j + 1}] {ref.split("/").pop()?.replace(".md", "")}
                  {j < msg.references.length - 1 ? " " : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 渲染：消息区域 ──
  function renderMessages() {
    return (
      <div
        className={`overflow-y-auto space-y-3 ${isMain ? "flex-1 px-4 py-4" : "flex-1 px-2 py-2"}`}
      >
        {messages.length === 0 && !isSearching && !isGenerating && (
          <div className={`text-center ${isMain ? "py-16" : "py-4"}`}>
            <p className={`text-[var(--color-text-muted)] ${isMain ? "text-sm" : "text-xs"}`}>
              基于 Wiki 知识库回答投资研究问题
            </p>
            <p className="mt-2 text-xs text-[var(--color-text-muted)] opacity-60">
              {isMain
                ? '试试："宁德时代最新订单情况" / "光模块产业链有哪些标的"'
                : '试试："宁德时代" / "光模块"'}
            </p>
          </div>
        )}

        {messages.map(renderMessage)}

        {isSearching && (
          <div className={`flex items-center gap-2 px-1 ${isMain ? "text-sm" : "text-xs"} text-[var(--color-text-muted)]`}>
            <span className="inline-block w-3 h-3 border-2 border-[var(--color-accent)]/40 border-t-[var(--color-accent)] rounded-full animate-spin" />
            检索 Wiki 页面...
          </div>
        )}

        {isGenerating && (
          <div className={`flex items-center gap-2 px-1 ${isMain ? "text-sm" : "text-xs"} text-[var(--color-text-muted)]`}>
            <span className="inline-block w-3 h-3 border-2 border-[var(--color-accent)]/40 border-t-[var(--color-accent)] rounded-full animate-spin" />
            LLM 生成回答...
          </div>
        )}

        {error && (
          <div className={`text-[var(--color-danger)] bg-red-50 dark:bg-red-900/10 rounded px-3 py-2 flex items-center justify-between ${isMain ? "text-sm" : "text-xs"}`}>
            <span className="truncate flex-1">{error}</span>
            <button className="ml-2 font-bold shrink-0" onClick={clearError}>×</button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    );
  }

  // ── 渲染：输入区域 ──
  function renderInput() {
    return (
      <div className={`border-t border-[var(--color-border)] shrink-0 ${isMain ? "p-3" : "p-2"}`}>
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，基于 Wiki 回答..."
            disabled={isGenerating}
            className={`flex-1 rounded border border-[var(--color-border)]
                       bg-[var(--color-editor-bg)] outline-none
                       focus:border-[var(--color-accent)]/50
                       disabled:opacity-50 ${isMain ? "px-3 py-2 text-sm" : "px-2 py-1 text-xs"}`}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            className={`rounded bg-[var(--color-accent)] text-white font-medium
                       hover:opacity-90 disabled:opacity-40 shrink-0 cursor-pointer
                       ${isMain ? "px-5 py-2 text-sm" : "px-2 py-1 text-xs"}`}
          >
            发送
          </button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // MAIN VARIANT: 两栏布局 — 左侧对话列表 + 右侧聊天
  // ══════════════════════════════════════════════════════════════════
  if (isMain) {
    return (
      <div className="flex flex-1 min-h-0">
        {/* ── Left: Conversation list ── */}
        <div className="w-52 flex-shrink-0 border-r border-[var(--color-border)]
                        flex flex-col bg-[var(--color-bg-tertiary)]/50">
          {/* Header: new conversation */}
          <div className="p-2 border-b border-[var(--color-border)] shrink-0">
            <button
              onClick={handleNewConv}
              className="w-full flex items-center justify-center gap-1 px-3 py-1.5
                         text-xs font-medium rounded-md
                         bg-[var(--color-accent)]/10 text-[var(--color-accent)]
                         hover:bg-[var(--color-accent)]/20
                         transition-colors cursor-pointer"
            >
              + 新建对话
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {sortedConvs.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="text-xs text-[var(--color-text-muted)] opacity-60">
                  暂无对话
                </p>
                <p className="text-[10px] text-[var(--color-text-muted)] opacity-40 mt-1">
                  输入问题开始新对话
                </p>
              </div>
            ) : (
              sortedConvs.map(renderConvItem)
            )}
          </div>
        </div>

        {/* ── Right: Chat area ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center px-4 py-1.5 border-b border-[var(--color-border)] shrink-0">
            <span className="font-semibold text-sm text-[var(--color-text)] truncate flex-1">
              {currentConv ? currentConv.title : "新对话"}
            </span>
          </div>

          {/* Messages */}
          {renderMessages()}

          {/* Input */}
          {renderInput()}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // SIDEBAR VARIANT: 折叠/展开 单栏
  // ══════════════════════════════════════════════════════════════════
  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-sidebar)]">
      {/* ── 收起状态：仅输入条 ── */}
      {!expanded && (
        <div className="p-2">
          <div
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--color-border)]
                        bg-[var(--color-editor-bg)] cursor-text"
            onClick={() => setExpanded(true)}
          >
            <span className="text-xs text-[var(--color-text-muted)] shrink-0">? 问答</span>
            <span className="text-xs text-[var(--color-text-muted)]/50 flex-1 truncate">
              输入问题搜索 Wiki...
            </span>
            {conversations.length > 0 && (
              <button
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] shrink-0 px-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowConvList(!showConvList);
                }}
                title="对话历史"
              >
                📋
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 展开状态 ── */}
      {expanded && (
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)]">
            <button
              className="text-xs px-1 hover:text-[var(--color-accent)] shrink-0"
              onClick={() => setExpanded(false)}
              title="收起"
            >
              ▼
            </button>
            <span className="text-xs font-medium flex-1 truncate">
              {currentConv ? currentConv.title : "新对话"}
            </span>
            <button
              className="text-xs px-1.5 hover:text-[var(--color-accent)] shrink-0"
              onClick={handleNewConv}
              title="新建对话"
            >
              +
            </button>
            <button
              className="text-xs px-1 hover:text-[var(--color-accent)] shrink-0"
              onClick={() => setShowConvList(!showConvList)}
              title="对话列表"
            >
              ☰
            </button>
          </div>

          {/* Conversation dropdown */}
          {showConvList && (
            <div className="border-b border-[var(--color-border)] max-h-32 overflow-y-auto bg-[var(--color-sidebar)]">
              {conversations.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] p-2">暂无历史对话</p>
              ) : (
                sortedConvs.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-1 px-2 py-1 text-xs cursor-pointer
                      hover:bg-[var(--color-accent)]/10
                      ${c.id === currentConvId ? "bg-[var(--color-accent)]/10 font-medium" : ""}`}
                    onClick={() => handleSelectConv(c.id)}
                  >
                    <span className="flex-1 truncate">{c.title}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                      {fmtDate(c.updated)}
                    </span>
                    <button
                      className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)] shrink-0 px-0.5"
                      onClick={(e) => handleDeleteConv(e, c.id)}
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Messages */}
          {renderMessages()}

          {/* Input */}
          {renderInput()}
        </div>
      )}
    </div>
  );
}
