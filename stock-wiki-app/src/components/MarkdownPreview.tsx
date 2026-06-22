import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
}

/** 解析 wiki 页面（---json {…} --- 格式），返回 JSON frontmatter 字符串和正文 */
function parseFrontmatter(content: string): { json: string | null; body: string } {
  if (!content) return { json: null, body: "" };

  if (content.startsWith("---json")) {
    const afterPrefix = content.substring(7).trimStart();
    const closeIdx = afterPrefix.indexOf("\n---");
    if (closeIdx !== -1) {
      const jsonStr = afterPrefix.substring(0, closeIdx).trim();
      try {
        JSON.parse(jsonStr);
        const body = afterPrefix.substring(closeIdx + 4).trimStart();
        return { json: jsonStr, body };
      } catch {
        // JSON 解析失败 → 整体作为纯文本展示
      }
    }
  }

  return { json: null, body: content };
}

export default function MarkdownPreview({ content }: Props) {
  const { json, body } = useMemo(() => parseFrontmatter(content), [content]);

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        (empty)
      </div>
    );
  }

  return (
    <div className="wiki-page">
      {json && (
        <details className="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden" open>
          <summary className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text)] select-none bg-[var(--color-bg-secondary)]">
            📋 Frontmatter
          </summary>
          <pre className="p-3 text-xs text-[var(--color-text-secondary)] overflow-x-auto whitespace-pre font-mono leading-relaxed border-t border-[var(--color-border)]">
            <code>{json}</code>
          </pre>
        </details>
      )}

      {body.trim() ? (
        <div className="markdown-preview">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {body}
          </ReactMarkdown>
        </div>
      ) : (
        !json && (
          <p className="text-sm text-[var(--color-text-muted)] italic">
            (无正文)
          </p>
        )
      )}
    </div>
  );
}
