import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";
import {
  FilePanelController,
  FormattingToolbarController,
  LinkToolbarController,
  SuggestionMenuController,
  TableHandlesController,
  useEditorState,
  useExtensionState,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { offset as floatingOffset, shift as floatingShift } from "@floating-ui/react";
import {
  clonePageContent,
  getContentSignature,
  normalizePageContent,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { CustomSlashMenu } from "@/components/editor/core/CustomSlashMenu";
import {
  EditorFormattingToolbar,
  shouldRenderFormattingToolbar,
} from "@/components/editor/toolbars/formatting";
import { AIMenuController } from "@blocknote/xl-ai";
import { useFormattingToolbarAi } from "@/components/editor/state/formattingToolbarAi";
import { EditorSideMenu } from "@/components/editor/core/EditorSideMenu";
import { ImageLightbox } from "@/components/editor/image/ImageLightbox";
import { EditorLinkToolbar } from "@/components/editor/toolbars/link/EditorLinkToolbar";
import { FindInPageBar } from "@/components/editor/find/FindInPageBar";
import { closeAllOverlays } from "@/lib/closeAllOverlays";
import { useTabs } from "@/stores/useTabs";

// Sub-component and modular utility imports
import { EditorFilePanel } from "@/components/editor/menus/EditorFilePanel";
import { GooseTableHandle, GooseTableExtendButton } from "@/components/editor/menus/GooseTableHandle";
import { EditorContextMenu } from "@/components/editor/menus/EditorContextMenu";
import { editorSchema } from "@/components/editor/core/schema";
import { shouldOpenSlashSuggestionMenu } from "@/components/editor/utils/slashMenuPolicy";
import { getQuicknoteSlashMenuFloatingOptions } from "@/components/editor/utils/quicknoteSlashMenuFloating";
import { LocalFileTitle } from "@/pages/workspace/components/page/LocalFileTitle";

// Re-exports to prevent broken imports elsewhere
export {
  normalizeClipboardLineEndings,
  looksLikeMarkdownFragment,
  stripMarkdownHardBreaks,
  normalizeMarkdownPasteText,
  parseMarkdownLink,
  shouldPreferVisibleSelectionText,
  isValidUrl,
} from "@/components/editor/utils/clipboard";

export {
  isBottomEditorBlankClick,
  getSelectedPlainTextContext,
  getSelectedCellPlainText,
  getElementFromNode,
  isInteractiveEditorTarget,
} from "@/components/editor/utils/selection";

export { editorSchema } from "@/components/editor/core/schema";

type EditorComposerProps = {
  editor: any;
  editable: boolean;
  page: any;
  editorContainerRef: RefObject<HTMLDivElement | null>;
  handleEditorBlankMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleEditorPasteCapture: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  getSlashItems: (query: string) => Promise<any[]>;
  pageIdForUpdateRef: RefObject<string | null>;
  syncedContentSignatureRef: RefObject<string | null>;
  debouncedUpdate: ((id: string, content: BlockNoteContent) => void) & { cancel: () => void };
  /** 自上次程序化同步（切页/外部重载）以来用户是否真实交互过（见 Editor.tsx 意图门控）。 */
  userInteractedRef: RefObject<boolean>;
  /** 静默同步 store（不标脏、不入保存队列）：用于编辑器初始化后的异步 props 补全。 */
  silentContentSync: (content: BlockNoteContent) => void;
  isEditorFullWidth: boolean;
  effectiveTheme: "light" | "dark";
  tableEvenColumnWidth: boolean;
  searchProviders: any[];
  customActions: any[];
  /** 是否渲染块侧边菜单（+ / ⋮⋮）。速记小窗传 false 不显示，仅主编辑器显示。 */
  showSideMenu?: boolean;
  /**
   * 为 true 时强制隐藏格式化工具栏（仅在空白区域 mousedown 期间短暂置 true 用于消闪，
   * 由 Editor.tsx 的空白点击处理器管理）。
   */
  suppressFormattingToolbar?: boolean;
};

export function EditorComposer({
  editor,
  editable,
  page,
  editorContainerRef,
  handleEditorBlankMouseDown,
  handleEditorPasteCapture,
  getSlashItems,
  pageIdForUpdateRef,
  syncedContentSignatureRef,
  debouncedUpdate,
  userInteractedRef,
  silentContentSync,
  isEditorFullWidth,
  effectiveTheme,
  tableEvenColumnWidth,
  searchProviders,
  customActions,
  showSideMenu = true,
  suppressFormattingToolbar = false,
}: EditorComposerProps) {
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkPopoverUrl, setLinkPopoverUrl] = useState("");
  const linkPopoverRef = useRef<HTMLDivElement | null>(null);
  const [findBarOpen, setFindBarOpen] = useState(false);

  useEffect(() => {
    const handleOpenFind = () => {
      // 先关其它弹层，再开查找栏。setTimeout 让 Escape 引发的 commit 先跑完，
      // 避免被同步的 close 路径反吃掉。
      closeAllOverlays();
      setTimeout(() => setFindBarOpen(true), 0);
    };
    window.addEventListener("goose-note:editor-find-open", handleOpenFind);
    return () =>
      window.removeEventListener("goose-note:editor-find-open", handleOpenFind);
  }, []);

  useEffect(() => {
    const handleOpen = () => {
      setLinkPopoverUrl("");
      setLinkPopoverOpen(true);
    };
    const handleClose = () => setLinkPopoverOpen(false);
    document.addEventListener("goose-open-link-popover", handleOpen);
    document.addEventListener("goose-close-link-popover", handleClose);
    return () => {
      document.removeEventListener("goose-open-link-popover", handleOpen);
      document.removeEventListener("goose-close-link-popover", handleClose);
    };
  }, []);

  useEffect(() => {
    if (!linkPopoverOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (linkPopoverRef.current?.contains(target)) return;
      setLinkPopoverOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLinkPopoverOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [linkPopoverOpen]);

  const handleLinkPopoverSubmit = () => {
    const trimmed = linkPopoverUrl.trim();
    if (trimmed) {
      editor.createLink(trimmed);
    }
    setLinkPopoverOpen(false);
    setLinkPopoverUrl("");
  };

  const formattingToolbarStoreOpen = useExtensionState(FormattingToolbarExtension, { editor });
  const formattingToolbarSelectionAllowed = useEditorState({
    editor,
    on: "selection",
    selector: ({ editor }) => shouldRenderFormattingToolbar(editor),
  });
  const formattingToolbarAiActive = useFormattingToolbarAi((s) => s.active);
  const formattingToolbarFloatingOptions = useMemo(
    () => ({
      useFloatingOptions: {
        open:
          !suppressFormattingToolbar &&
          (formattingToolbarAiActive ||
          (formattingToolbarStoreOpen && formattingToolbarSelectionAllowed)),
        // 锁定在选区上方，去掉默认的 flip()：跨多行拖选时选区包围盒不断变高，
        // flip() 会在 top/bottom 之间反复翻转导致工具栏上下抖动（BlockNote #1569）。
        // 仅保留 offset + 受限 shift，水平方向贴边时平移、不再纵向翻转。
        placement: "top-start" as const,
        middleware: [
          floatingOffset(10),
          floatingShift({ crossAxis: false, padding: 8 }),
        ],
      },
    }),
    [
      suppressFormattingToolbar,
      formattingToolbarAiActive,
      formattingToolbarSelectionAllowed,
      formattingToolbarStoreOpen,
    ],
  );

  const slashMenuFloatingOptions = useMemo(
    () => (__GOOSE_LITE__ ? getQuicknoteSlashMenuFloatingOptions() : undefined),
    [],
  );

  return (
    <EditorContextMenu
      editor={editor}
      editable={editable}
      page={page}
      editorContainerRef={editorContainerRef}
      handleEditorBlankMouseDown={handleEditorBlankMouseDown}
      handleEditorPasteCapture={handleEditorPasteCapture}
      searchProviders={searchProviders}
      customActions={customActions}
      effectiveTheme={effectiveTheme}
      isEditorFullWidth={isEditorFullWidth}
      tableEvenColumnWidth={tableEvenColumnWidth}
    >
      {page?.localFilePath && (
        <LocalFileTitle pageId={page.id} localFilePath={page.localFilePath} />
      )}
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={effectiveTheme}
        slashMenu={false}
        formattingToolbar={false}
        linkToolbar={false}
        sideMenu={false}
        tableHandles={false}
        filePanel={false}
        onChange={() => {
          const safePageId = pageIdForUpdateRef.current;
          if (!safePageId) return;
          // local-folder 页面跳过 normalizePageContent（含 ensureFirstTitleHeading），
          // 与 Editor.tsx 切页/commit 路径保持一致：否则 normalize 改写让签名与基线
          // 永不一致，打开后首个 onChange 即触发非 silent 保存（打开即写盘）。
          // 用户真实输入仍会让文档签名偏离基线，照常走 debouncedUpdate 保存。
          // 须与 Editor.tsx 的 isLocalFolderPage 判断保持一致：草稿页(__quicknote_draft__)
          // 同样豁免 normalize，否则 onChange 在此把首块强转 H1 并回写持久化，
          // 导致小窗重开后首块永久变成「标题1」。
          const isLocalPage =
            Boolean(page?.localFilePath) || page?.id === "__quicknote_draft__";
          const rawContent = clonePageContent(editor.document as BlockNoteContent);
          const nextContent = isLocalPage
            ? rawContent
            : normalizePageContent(rawContent);
          const nextSig = getContentSignature(nextContent);
          if (nextSig === syncedContentSignatureRef.current) return;
          syncedContentSignatureRef.current = nextSig;
          // 用户意图门控（仅 local 页面）：打开后无任何用户交互时的 onChange 来自
          // BlockNote 异步 props 补全（折叠块/视频/带属性图片等），静默同步 store 与
          // 基线、不入保存队列。一旦用户交互过（打字/IME/点击/拖拽…），照常入队保存。
          if (isLocalPage && !userInteractedRef.current) {
            silentContentSync(nextContent);
            return;
          }
          debouncedUpdate(safePageId, nextContent);
          if (userInteractedRef.current) {
            useTabs.getState().promotePreviewTab();
          }
        }}
      >
        {showSideMenu ? <EditorSideMenu /> : null}
        <TableHandlesController
          tableHandle={GooseTableHandle}
          extendButton={GooseTableExtendButton}
        />
        <FormattingToolbarController
          formattingToolbar={EditorFormattingToolbar}
          floatingUIOptions={formattingToolbarFloatingOptions}
        />
        <LinkToolbarController linkToolbar={EditorLinkToolbar} />
        <FilePanelController filePanel={EditorFilePanel} />
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={getSlashItems}
          floatingUIOptions={slashMenuFloatingOptions}
          shouldOpen={(event) =>
            shouldOpenSlashSuggestionMenu(event, editor, {
              allowSlashMenuOnFirstBlock:
                Boolean(page?.localFilePath) || page?.id === "__quicknote_draft__",
            })
          }
          suggestionMenuComponent={CustomSlashMenu as any}
          onItemClick={(item) => {
            if (item && "onItemClick" in item) {
              (item as any).onItemClick();
            }
          }}
        />
        <SuggestionMenuController
          triggerCharacter="、"
          getItems={getSlashItems}
          floatingUIOptions={slashMenuFloatingOptions}
          shouldOpen={(event) =>
            shouldOpenSlashSuggestionMenu(event, editor, {
              allowSlashMenuOnFirstBlock:
                Boolean(page?.localFilePath) || page?.id === "__quicknote_draft__",
            })
          }
          suggestionMenuComponent={CustomSlashMenu as any}
          onItemClick={(item) => {
            if (item && "onItemClick" in item) {
              (item as any).onItemClick();
            }
          }}
        />
        {/* 速记小窗（__GOOSE_LITE__）不挂 AI 菜单。 */}
        {!__GOOSE_LITE__ && <AIMenuController />}
      </BlockNoteView>
      {linkPopoverOpen && (
        <div
          ref={linkPopoverRef}
          className="absolute z-[20020] flex items-center gap-1.5 rounded-lg border border-border/80 bg-popover p-2 shadow-[0_8px_22px_rgba(15,23,42,0.1),0_1px_3px_rgba(15,23,42,0.06)] dark:border-white/15 dark:bg-[#2f3437]"
          style={{ top: 8, left: "50%", transform: "translateX(-50%)" }}
        >
          <input
            value={linkPopoverUrl}
            onChange={(e) => setLinkPopoverUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleLinkPopoverSubmit();
              }
              if (e.key === "Escape") {
                setLinkPopoverOpen(false);
              }
            }}
            placeholder="https://..."
            autoFocus
            className="h-8 w-56 rounded-md border border-transparent bg-background px-2.5 text-sm shadow-[inset_0_0_0_1px_hsl(var(--input)/0.8)] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          />
          <button
            type="button"
            onClick={handleLinkPopoverSubmit}
            className="flex h-8 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            确认
          </button>
        </div>
      )}
      <ImageLightbox editor={editor} editorContainerRef={editorContainerRef} />
      <FindInPageBar
        editor={editor}
        open={findBarOpen}
        onClose={() => setFindBarOpen(false)}
      />
    </EditorContextMenu>
  );
}
