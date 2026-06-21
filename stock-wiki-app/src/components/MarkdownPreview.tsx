import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
}

export default function MarkdownPreview({ content }: Props) {
  const processedContent = useMemo(() => {
    if (!content) return "";

    // Strip YAML frontmatter for preview
    const trimmed = content.trimStart();
    if (trimmed.startsWith("---")) {
      const end = trimmed.indexOf("---", 4);
      if (end !== -1) {
        return trimmed.substring(end + 3).trim();
      }
    }
    return content;
  }, [content]);

  if (!processedContent) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        (empty)
      </div>
    );
  }

  return (
    <div className="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
