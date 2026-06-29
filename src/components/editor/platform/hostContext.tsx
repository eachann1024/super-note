/**
 * 宿主注入上下文 —— 编辑器内核消费的应用级状态（settings + 当前页 + 跨页能力）。
 *
 * 编辑器内核**禁止直接 import 宿主 store**（usePages/useNotebooks/useSettings/useTabs）。
 * 宿主把这些 store 桥成下面的注入对象，经 <EditorHostProvider> 注入；编辑器内部只读
 * useEditorSettings() / useEditorPageContext()，或调注入回调。
 *
 * 字段以 extraction-blueprint.md §3「Store 处置决议」+「宿主注入接口最终形状」为准。
 * 编辑器自有类型（Page / BlockNoteContent / AISettings / CustomFonts 等）从 app 现有
 * 类型 import 复用，避免重复定义。
 *
 * 来源：plans/2026-06-01-Tauri迁移与编辑器抽取计划/extraction-blueprint.md §3
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Page } from "@/types";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type {
  AISettings,
  CustomFonts,
  CustomAction,
  SearchProvider,
  UToolsSettings,
} from "@/stores/settings";
import type {
  AiReferenceSuggestionItem,
  AiFileReferenceAttrs,
  ResolvedAiReferenceContext,
} from "@/components/editor/ai/composer/referenceLookup";
import type { EditorPlatform } from "./types";

/** 宿主透传给编辑器的设置（替换对 useSettings 的直读）。 */
export interface EditorSettings {
  theme: "light" | "dark" | "system";
  globalEditorFullWidth: boolean;
  tableEvenColumnWidth: boolean;
  customFonts: CustomFonts;
  defaultCodeBlockWrap: boolean;
  onDefaultCodeBlockWrapChange: (v: boolean) => void;
  /** 整个 ai slice 透传，编辑器内部按需读字段 */
  ai: AISettings;
  searchProviders: SearchProvider[];
  /** uTools 端有值，Tauri 端 null */
  utools: UToolsSettings | null;
  customActions: CustomAction[];
  /** 宿主提供的 redirect 能力（uTools 端：UToolsAdapter.redirect；Tauri 端：noop） */
  redirectAction?: (label: string | [string, string], payload?: unknown) => void;
  enterKeyBehavior: 'create-block' | 'save-exit';
}

/** 宿主透传给编辑器的「当前页 + 跨页能力」（替换对 usePages/useNotebooks/useTabs 的直读）。 */
export interface EditorPageContext {
  /** 替换 activePageId + getPage（宿主决定哪页激活） */
  page: Page;
  /** 宿主预算 notebook.editorFullWidth ?? globalEditorFullWidth */
  isEditorFullWidth: boolean;
  /** 替换 updatePage（去抖在宿主或编辑器内皆可）。silent=true 时宿主跳过标脏与写盘（切页/normalize 路径）。 */
  onContentChange: (content: BlockNoteContent, options?: { silent?: boolean }) => void;
  /** 替换 useTabs.openTab（chip 点击导航） */
  onOpenPage: (pageId: string) => void;
  /** 图片相对路径解析：返回当前激活页的本地文件路径 */
  getActivePageLocalFilePath: () => string | null;
  /** AI @mention 跨页能力（封装 usePages/useNotebooks 全量访问，编辑器不直接碰 store） */
  searchPages: (query: string) => AiReferenceSuggestionItem[];
  resolvePageContexts: (
    refs: AiFileReferenceAttrs[],
  ) => ResolvedAiReferenceContext[];
}

/** 编辑器对外 props（宿主接线在 Step 6 完成）。 */
export interface EditorProps {
  platform: EditorPlatform;
  settings: EditorSettings;
  pageContext: EditorPageContext;
  readonly?: boolean;
}

const EditorSettingsContext = createContext<EditorSettings | null>(null);
const EditorPageContextContext = createContext<EditorPageContext | null>(null);

export function EditorHostProvider({
  settings,
  pageContext,
  children,
}: {
  settings: EditorSettings;
  pageContext: EditorPageContext;
  children: ReactNode;
}) {
  return (
    <EditorSettingsContext.Provider value={settings}>
      <EditorPageContextContext.Provider value={pageContext}>
        {children}
      </EditorPageContextContext.Provider>
    </EditorSettingsContext.Provider>
  );
}

export function useEditorSettings(): EditorSettings {
  const ctx = useContext(EditorSettingsContext);
  if (!ctx) {
    throw new Error(
      "useEditorSettings 必须在 <EditorHostProvider> 内使用（宿主需注入 settings）。",
    );
  }
  return ctx;
}

export function useEditorPageContext(): EditorPageContext {
  const ctx = useContext(EditorPageContextContext);
  if (!ctx) {
    throw new Error(
      "useEditorPageContext 必须在 <EditorHostProvider> 内使用（宿主需注入 pageContext）。",
    );
  }
  return ctx;
}
