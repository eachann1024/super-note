/**
 * EditorHostBridge —— 宿主（uTools app）把应用 store 桥接成编辑器内核所需的注入对象。
 *
 * 编辑器内核（@/components/editor）不直接读 usePages/useNotebooks/useSettings/useTabs，
 * 也不直接碰平台 API；本桥读取这些 store 与 uTools 平台实现，组装成 EditorSettings /
 * EditorPageContext，经 <EditorPlatformProvider> + <EditorHostProvider> 注入，再渲染
 * 传入的 <Editor>（children）。
 *
 * 行为保持不变：注入对象的各字段/回调一一对应抽取前 Editor.tsx 内的 store 直读逻辑。
 *
 * 来源：plans/2026-06-01-Tauri迁移与编辑器抽取计划/extraction-blueprint.md §3 / §4 Step 6
 */
import { useMemo, type ReactNode } from "react";
import type { Page } from "@/types";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useSettings } from "@/stores/useSettings";
import { useTabs } from "@/stores/useTabs";
import { EditorPlatformProvider } from "@/components/editor/platform/context";
import {
  EditorHostProvider,
  type EditorSettings,
  type EditorPageContext,
} from "@/components/editor/platform/hostContext";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import {
  getAiReferenceSuggestionItems,
  resolveAiReferenceContexts,
} from "@/components/editor/ai/composer/referenceLookup";
import { utoolsEditorPlatform } from "@/lib/editor-platform/utools";
import { UToolsAdapter } from "@/lib/utools";

interface EditorHostBridgeProps {
  /** 当前被编辑的页（替换编辑器内核对 usePages.activePageId/getPage 的直读）。 */
  page: Page;
  /** 宿主预算：notebook.editorFullWidth ?? globalEditorFullWidth。 */
  isEditorFullWidth: boolean;
  /**
   * 内容变更落库回调的覆盖。默认走 usePages.updatePage 落库；速记小窗草稿模式传入此项，
   * 把内容写到草稿存储而非真实 page（草稿不入 pages map、不进笔记列表）。
   */
  onContentChangeOverride?: (content: BlockNoteContent, options?: { silent?: boolean }) => void;
  children: ReactNode;
}

export function EditorHostBridge({
  page,
  isEditorFullWidth,
  onContentChangeOverride,
  children,
}: EditorHostBridgeProps) {
  const theme = useSettings((s) => s.theme);
  const globalEditorFullWidth = useSettings((s) => s.globalEditorFullWidth);
  const tableEvenColumnWidth = useSettings((s) => s.tableEvenColumnWidth);
  const customFonts = useSettings((s) => s.customFonts);
  const defaultCodeBlockWrap = useSettings((s) => s.defaultCodeBlockWrap);
  const setDefaultCodeBlockWrap = useSettings((s) => s.setDefaultCodeBlockWrap);
  const ai = useSettings((s) => s.ai);
  const searchProviders = useSettings((s) => s.searchProviders);
  const utools = useSettings((s) => s.utools);
  const customActions = useSettings((s) => s.customActions);
  const enterKeyBehavior = useSettings((s) => s.enterKeyBehavior);

  const settings = useMemo<EditorSettings>(
    () => ({
      theme,
      globalEditorFullWidth,
      tableEvenColumnWidth,
      customFonts,
      defaultCodeBlockWrap,
      onDefaultCodeBlockWrapChange: setDefaultCodeBlockWrap,
      ai,
      searchProviders,
      utools,
      customActions,
      enterKeyBehavior,
      redirectAction: (label, payload) => {
        UToolsAdapter.redirect(label as string | [string, string], payload);
      },
    }),
    [
      theme,
      globalEditorFullWidth,
      tableEvenColumnWidth,
      customFonts,
      defaultCodeBlockWrap,
      setDefaultCodeBlockWrap,
      ai,
      searchProviders,
      utools,
      customActions,
      enterKeyBehavior,
    ],
  );

  const pageContext = useMemo<EditorPageContext>(
    () => ({
      page,
      isEditorFullWidth,
      onContentChange: (content: BlockNoteContent, options?: { silent?: boolean }) => {
        if (onContentChangeOverride) {
          onContentChangeOverride(content, options);
          return;
        }
        usePages.getState().updatePage(page.id, { content } as Partial<Page>, options?.silent ? { silent: true } : undefined);
      },
      onOpenPage: (pageId: string) => {
        useTabs.getState().openTab(pageId);
      },
      getActivePageLocalFilePath: () => {
        const activeId = usePages.getState().activePageId;
        const activePage = activeId
          ? usePages.getState().pages[activeId]
          : null;
        return activePage?.localFilePath ?? null;
      },
      searchPages: (query: string) => {
        const { pages } = usePages.getState();
        const { notebooks, activeNotebookId } = useNotebooks.getState();
        return getAiReferenceSuggestionItems(query, pages, notebooks, activeNotebookId);
      },
      resolvePageContexts: (refs) => {
        const { pages } = usePages.getState();
        const { notebooks } = useNotebooks.getState();
        return resolveAiReferenceContexts(refs, pages, notebooks);
      },
    }),
    [page, isEditorFullWidth, onContentChangeOverride],
  );

  // 触摸一次 useNotebooks 订阅，确保 notebook 变化时桥重渲染（宿主预算 isEditorFullWidth 在外层算）。
  void useNotebooks((s) => s.activeNotebookId);

  return (
    <EditorPlatformProvider platform={utoolsEditorPlatform}>
      <EditorHostProvider settings={settings} pageContext={pageContext}>
        {children}
      </EditorHostProvider>
    </EditorPlatformProvider>
  );
}
