import { useEffect, useMemo, useRef, useState } from "react";
import { useCreateBlockNote, BlockNoteViewRaw as BlockNoteView } from "@blocknote/react";
import { zh } from "@blocknote/core/locales";
import "@blocknote/react/style.css";
import { useSettings } from "@/stores/useSettings";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import {
  normalizePageContent,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { editorSchema } from "@/components/editor/core/EditorComposer";
import { cn } from "@/lib/utils";

interface HistoryReadOnlyEditorProps {
  content: BlockNoteContent;
  /** 当前版本标识；变化时用 replaceBlocks 换内容，而非重建实例 */
  versionKey: string;
}

/**
 * 只读 BlockNote 渲染器，专供历史模式右侧主区使用。
 *
 * 设计取舍：
 *  - 不复用 Editor.tsx：那是写态编辑器，绑死 usePages.activePageId、有 debouncedUpdate / file drop / shortcuts，
 *    在历史模式下这些副作用全是噪音。这里只要一个干净的只读渲染。
 *  - 切版本时用 editor.replaceBlocks 原地换内容，而非靠外层 key 重建实例。
 *    重建 BlockNote/ProseMirror 实例开销极大，uTools 旧内核下连续回看多个版本会卡死主线程；
 *    复用同一实例只换 blocks 把开销降到一次解析。
 *  - 不挂 SideMenu / FormattingToolbar / SlashMenu：只读不需要任何编辑控件。
 */
export function HistoryReadOnlyEditor({
  content,
  versionKey,
}: HistoryReadOnlyEditorProps) {
  const { globalEditorFullWidth, theme } = useSettings();
  const { activePageId } = usePages();
  const { notebooks } = useNotebooks();
  const activePage = activePageId ? usePages.getState().pages[activePageId] : null;
  const activeNotebook = activePage ? notebooks[activePage.workspaceId] : undefined;
  const isEditorFullWidth = Boolean(
    activeNotebook?.editorFullWidth ?? globalEditorFullWidth,
  );
  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const resolve = () => {
      if (theme === "dark") return setEffectiveTheme("dark");
      if (theme === "system") {
        return setEffectiveTheme(
          window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        );
      }
      setEffectiveTheme("light");
    };
    resolve();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => resolve();
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  const normalized = useMemo(() => normalizePageContent(content), [content]);

  const editor = useCreateBlockNote({
    initialContent: normalized as any,
    schema: editorSchema,
    dictionary: zh,
    domAttributes: {
      editor: {
        class: "goose-blocknote-editor",
      },
    },
    // 与 Editor.tsx 共享同一解析实现和 ObjectURL 缓存，避免历史视图重复泄漏
    resolveFileUrl: async (url) => {
      const { resolveImageRefToUrl } = await import("@/lib/imageStorage/resolveUrl");
      const { usePages } = await import("@/stores/usePages");
      const activePageId = usePages.getState().activePageId;
      const activePage = activePageId ? usePages.getState().pages[activePageId] : null;
      return resolveImageRefToUrl(url, activePage?.localFilePath ?? null);
    },
  });

  // 同步 isEditable（BlockNote 的 editable 在 view 上是 prop，editor 实例上也维护一份）
  useEffect(() => {
    editor.isEditable = false;
  }, [editor]);

  // 切版本时原地换内容：initialContent 只在创建时生效一次，后续版本靠 replaceBlocks
  // 把整篇文档换掉，复用同一编辑器实例（不重建，避免卡死）。
  // 以 normalized 引用为准（content 真正到达才换），而非 versionKey——后者会先于
  // 异步内容变化，导致用旧内容多刷一次。
  const renderedContentRef = useRef(normalized);
  useEffect(() => {
    if (renderedContentRef.current === normalized) return; // 首次渲染由 initialContent 承担
    renderedContentRef.current = normalized;
    editor.replaceBlocks(editor.document, normalized as any);
  }, [editor, normalized]);

  // 与主 Editor 在 WorkspaceLayout 内的包裹一致；父级 page-scroll-container 全宽为 px-14、窄栏为 px-8
  return (
    <div
      className={cn(
        "mt-1 pt-1 pb-12",
        isEditorFullWidth ? "max-w-full" : "w-full max-w-4xl mx-auto",
      )}
    >
      <BlockNoteView
        editor={editor}
        editable={false}
        theme={effectiveTheme}
        slashMenu={false}
        formattingToolbar={false}
        sideMenu={false}
        tableHandles={false}
        filePanel={false}
      />
    </div>
  );
}
