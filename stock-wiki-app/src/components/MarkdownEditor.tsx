import { useEffect, useRef } from "react";
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";

interface Props {
  value: string;
  onChange: (markdown: string) => void;
}

function MilkdownEditorInner({ value, onChange }: Props) {
  const editorRef = useRef<Editor | null>(null);

  // Track if change came from external (value prop) vs internal (user typing)
  const externalUpdateRef = useRef(false);
  const prevValueRef = useRef(value);

  useEditor((root) => {
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, value);
        const listenerManager = ctx.get(listenerCtx);
        listenerManager.markdownUpdated((_, markdown) => {
          if (!externalUpdateRef.current) {
            onChange(markdown);
          }
        });
      })
      .use(nord)
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener);

    editorRef.current = editor;
    return editor;
  }, []);

  // Sync external value changes into editor
  useEffect(() => {
    if (editorRef.current && value !== prevValueRef.current) {
      externalUpdateRef.current = true;
      editorRef.current.action((ctx) => {
        ctx.set(defaultValueCtx, value);
      });
      prevValueRef.current = value;
      // Reset flag after microtask
      queueMicrotask(() => {
        externalUpdateRef.current = false;
      });
    }
  }, [value]);

  return <Milkdown />;
}

export default function MarkdownEditor({ value, onChange }: Props) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner value={value} onChange={onChange} />
    </MilkdownProvider>
  );
}
