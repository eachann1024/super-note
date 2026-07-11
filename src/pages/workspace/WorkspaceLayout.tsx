import { type RefObject, useEffect, useRef } from "react";
import * as LucideIcons from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useSettings } from "@/stores/useSettings";
import { useTabs } from "@/stores/useTabs";
import { Sidebar } from "./components/sidebar/Sidebar";
import { PageEmptyState } from "./components/page/PageEmptyState";
import { PageHeader } from "./components/page/PageHeader";
import { IconSelector } from "./components/shared/IconSelector";
import { CommandPalette } from "./components/command/CommandPalette";
import { AIFeatureNotice } from "./components/AIFeatureNotice";
import { Editor, type EditorRef } from "@/components/editor/core/Editor";
import { locateAndHighlight } from "@/components/editor/find/searchHighlightLocate";
import { EditorHostBridge } from "./components/editor-host/EditorHostBridge";
import {
  HistoryToolbar,
  HistoryReader,
} from "./components/history/HistoryView";
import { useHistoryView } from "@/stores/useHistoryView";
import {
  permanentlyDeletePageWithCleanup,
  restorePageWithToast,
} from "@/lib/page-delete-actions";
import { NotebookAiPanel } from "./components/notebook-ai/NotebookAiPanel";
import { useNotebookAiPanel } from "./components/notebook-ai/useNotebookAiPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { extractPlainText } from "@/components/editor/utils/blocknote-content";

interface WorkspaceLayoutProps {
  isDragging: boolean;
  dragIntent: "folder" | "text-file" | "file";
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => Promise<void>;
  editorRef: RefObject<EditorRef | null>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function WorkspaceLayout({
  isDragging,
  dragIntent,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  editorRef,
  scrollContainerRef,
}: WorkspaceLayoutProps) {
  const { activePageId, updatePage, getPage } = usePages(
    useShallow((s) => ({
      activePageId: s.activePageId,
      updatePage: s.updatePage,
      getPage: s.getPage,
    })),
  );
  const { openTabs, activeTabId, openWelcomeTab } = useTabs(
    useShallow((s) => ({
      openTabs: s.openTabs,
      activeTabId: s.activeTabId,
      openWelcomeTab: s.openWelcomeTab,
    })),
  );
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const isWelcomeTab = activeTab?.type === "welcome";
  const openWelcomeTabHandler = () => {
    openWelcomeTab();
  };
  const aiEnabled = useSettings((s) => s.ai.enabled);
  const {
    isOpen: aiPanelOpen,
    open: openAiPanel,
    toggle: toggleAiPanel,
    close: closeAiPanel,
    capturedSelection: aiPanelCapturedSelection,
    consumeCapturedSelection: consumeAiPanelCapturedSelection,
  } = useNotebookAiPanel();
  const searchHighlightNonce = usePages((s) => s.searchHighlightNonce);
  const searchHighlightQuery = usePages((s) => s.searchHighlightQuery);
  const searchHighlightPageId = usePages((s) => s.searchHighlightPageId);
  const handledSearchHighlightNonce = usePages(
    (s) => s.handledSearchHighlightNonce,
  );
  const setHandledSearchHighlightNonce = usePages(
    (s) => s.setHandledSearchHighlightNonce,
  );
  const { activeNotebookId, notebooks } = useNotebooks(
    useShallow((s) => ({
      activeNotebookId: s.activeNotebookId,
      notebooks: s.notebooks,
    })),
  );
  const globalEditorFullWidth = useSettings((s) => s.globalEditorFullWidth);
  const historyActivePageId = useHistoryView((s) => s.active);
  const inHistoryMode =
    !!historyActivePageId && historyActivePageId === activePageId;

  const page = activePageId ? getPage(activePageId) : undefined;
  const activeNotebook = activeNotebookId
    ? notebooks[activeNotebookId]
    : undefined;
  const pageNotebook = page ? notebooks[page.workspaceId] : undefined;
  const isActiveLocalFolder = activeNotebook?.source === "local-folder";
  const isLocalFolderPage = pageNotebook?.source === "local-folder";
  const aiAvailableForNotebook = aiEnabled && !isActiveLocalFolder;
  const isEditorFullWidth = Boolean(
    pageNotebook?.editorFullWidth ?? globalEditorFullWidth,
  );

  // 全局搜索「跳转即定位」：监听搜索高亮信号，落到匹配块并展开折叠 + 高亮。
  // 信号由命令面板写入（只带 query，不带 blockId），见 searchHighlightLocate.ts。
  //
  // 关键：点搜索结果时「切页」是异步的，nonce 信号到达那一刻 activePageId 往往还没追上
  // 目标页。所以本 effect 不能只依赖 nonce，否则首跑被 pageId 守卫挡掉后永不重试。
  // 改为：依赖 activePageId/page 一并参与，用 handledSearchHighlightNonce 做幂等去重，
  // 等切页落定、目标页 editor ready 后自然会再跑一次并完成定位。
  const locateRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mod+J 快捷键（useAppHotkeys 派发）→ 开关 AI 面板，与 UI 按钮门控一致：未启用 AI 时不响应
  useEffect(() => {
    const onToggle = () => {
      if (!aiAvailableForNotebook) return;
      toggleAiPanel();
    };
    window.addEventListener("goose-note:toggle-ai-panel", onToggle);
    return () =>
      window.removeEventListener("goose-note:toggle-ai-panel", onToggle);
  }, [aiAvailableForNotebook, toggleAiPanel]);

  // 编辑器内的 Space / 斜杠菜单 / 选区 AI 在 uTools 原生模型模式下共用此入口。
  // 使用 open 而非 toggle，重复触发不会把已经打开的面板关掉。
  useEffect(() => {
    const onOpen = (event: Event) => {
      if (!aiAvailableForNotebook) return;
      const detail = (event as CustomEvent<unknown>).detail;
      const capture =
        detail &&
        typeof detail === "object" &&
        (detail as Record<string, unknown>).version === 1 &&
        typeof (detail as Record<string, unknown>).pageId === "string" &&
        Boolean((detail as Record<string, unknown>).selection)
          ? (detail as Parameters<typeof openAiPanel>[0])
          : null;
      openAiPanel(capture);
    };
    window.addEventListener("goose-note:open-ai-panel", onOpen);
    return () => window.removeEventListener("goose-note:open-ai-panel", onOpen);
  }, [aiAvailableForNotebook, openAiPanel]);

  // AI 功能不可用时强制收起侧栏面板，避免 localStorage 仍为 true 导致下次误展开
  useEffect(() => {
    if (!aiAvailableForNotebook) closeAiPanel();
  }, [aiAvailableForNotebook, closeAiPanel]);

  useEffect(() => {
    if (locateRetryRef.current) {
      clearTimeout(locateRetryRef.current);
      locateRetryRef.current = null;
    }
    if (!searchHighlightNonce || searchHighlightNonce <= 0) return;
    // 这个 nonce 已经处理过了，跳过（幂等，避免重复定位/重复高亮）
    if (searchHighlightNonce === handledSearchHighlightNonce) return;
    if (!searchHighlightQuery) return;
    // 信号指向的页面还没成为当前活动页 → 等切页完成后本 effect 会因 activePageId
    // 变化再次运行，那时再继续。不在这里标记 handled，留待真正定位成功。
    if (!searchHighlightPageId || searchHighlightPageId !== activePageId)
      return;
    if (inHistoryMode || !page) return;

    const nonceToHandle = searchHighlightNonce;
    const query = searchHighlightQuery;
    let attempts = 0;
    const tryLocate = () => {
      const editor = editorRef.current?.editor;
      if (editor) {
        locateAndHighlight(editor, query);
        setHandledSearchHighlightNonce(nonceToHandle);
        locateRetryRef.current = null;
        return;
      }
      // 切页后编辑器可能还没挂载/换内容，短轮询等待 ready（上限约 1.5s）
      if (attempts++ < 30) {
        locateRetryRef.current = setTimeout(tryLocate, 50);
      }
    };
    // 首次延一帧，让切页的 replaceBlocks 先把目标页内容铺好
    locateRetryRef.current = setTimeout(tryLocate, 60);

    return () => {
      if (locateRetryRef.current) {
        clearTimeout(locateRetryRef.current);
        locateRetryRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchHighlightNonce, activePageId, page]);

  return (
    <>
      <style>{`
        @keyframes slow-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .animate-slow-pulse {
          animation: slow-pulse 4s ease-in-out infinite;
        }
      `}</style>
      <div
        className="workspace-shell window-shell-safe-top flex overflow-hidden bg-background text-foreground"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {isDragging && (
          <div className="fixed inset-0 z-[25000] flex items-center justify-center bg-[hsl(var(--goose-editor-bg)/0.96)] animate-in fade-in duration-150">
            <div className="flex min-h-[188px] min-w-[312px] flex-col items-center justify-center rounded-[14px] border border-border/70 bg-[hsl(var(--goose-shell-bg)/0.98)] px-10 py-8 text-center shadow-[0_18px_42px_rgba(15,23,42,0.12),0_1px_3px_rgba(15,23,42,0.06)] dark:border-white/10 dark:shadow-[0_18px_42px_rgba(0,0,0,0.32)]">
              {dragIntent === "folder" ? (
                <LucideIcons.FolderOpen className="mb-4 h-12 w-12 text-muted-foreground/80" />
              ) : dragIntent === "text-file" ? (
                <LucideIcons.FileText className="mb-4 h-12 w-12 text-muted-foreground/80" />
              ) : (
                <LucideIcons.FileQuestion className="mb-4 h-12 w-12 text-muted-foreground/70" />
              )}
              <p className="text-base font-medium text-foreground">
                {dragIntent === "folder"
                  ? "松手打开文件夹"
                  : dragIntent === "text-file"
                    ? "松手导入文本文件"
                    : "松手后检查文件"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {dragIntent === "folder"
                  ? "会作为本地文件夹记事本载入"
                  : "支持 .md、.markdown、.txt"}
              </p>
            </div>
          </div>
        )}
        <CommandPalette />
        <AIFeatureNotice />
        <div className="workspace-stage">
          <Sidebar
            className="workspace-sidebar-pane"
            disableResize={false}
            selectedPageId={activePageId}
            editorRef={editorRef}
            scrollContainerRef={scrollContainerRef}
          />

          <main className="workspace-main-sheet relative flex-1 flex flex-col h-full overflow-hidden">
            {isWelcomeTab ? (
              <>
                <PageHeader
                  onOpenSearch={openWelcomeTabHandler}
                  aiPanelOpen={aiAvailableForNotebook && aiPanelOpen}
                  onToggleAiPanel={
                    aiAvailableForNotebook ? toggleAiPanel : undefined
                  }
                />
                <PageEmptyState />
              </>
            ) : activePageId && page && inHistoryMode ? (
              <>
                <HistoryToolbar />
                <div className="workspace-editor-surface relative ml-0 mt-0 flex-1 min-h-0 overflow-hidden">
                  <div
                    className={cn(
                      "h-full overflow-y-auto page-scroll-container bg-[hsl(var(--goose-editor-bg))]",
                    )}
                  >
                    <div
                      className={cn(
                        "flex min-h-full flex-col pt-0",
                        isEditorFullWidth ? "px-14" : "px-8",
                      )}
                    >
                      <HistoryReader />
                    </div>
                  </div>
                </div>
              </>
            ) : activePageId && page ? (
              <>
                <EditorHostBridge
                  page={page}
                  isEditorFullWidth={isEditorFullWidth}
                >
                  <div className="workspace-editor-surface relative ml-0 mt-0 flex min-h-0 flex-1 flex-row gap-2 overflow-hidden !bg-[hsl(var(--goose-shell-bg))]">
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-[hsl(var(--goose-editor-bg))]">
                      <PageHeader
                        page={page}
                        onOpenSearch={openWelcomeTabHandler}
                        onToggleFavorite={() =>
                          updatePage(activePageId, { isFavorite: !page.isFavorite })
                        }
                        onTogglePinned={() =>
                          updatePage(activePageId, { isPinned: !page.isPinned })
                        }
                        onRestore={() => restorePageWithToast(activePageId)}
                        onDelete={() =>
                          void permanentlyDeletePageWithCleanup(activePageId)
                        }
                        aiPanelOpen={aiAvailableForNotebook && aiPanelOpen}
                        onToggleAiPanel={
                          aiAvailableForNotebook ? toggleAiPanel : undefined
                        }
                      />
                      <div
                        ref={scrollContainerRef}
                        className={cn(
                          "h-full flex-1 min-w-0 overflow-y-auto page-scroll-container bg-[hsl(var(--goose-editor-bg))]",
                        )}
                      >
                        {(() => {
                          const contentBlocks = Array.isArray(page.content)
                            ? page.content
                            : Array.isArray(page.content?.content)
                              ? page.content.content
                              : [];
                          const hasBodyContent = contentBlocks
                            .slice(1)
                            .some(
                              (block: unknown) =>
                                extractPlainText([block] as any).trim().length >
                                0,
                            );
                          const isNewPage =
                            page.createdAt === page.updatedAt &&
                            !hasBodyContent;

                          return (
                            <div
                              className={cn(
                                "flex min-h-full flex-col",
                                isEditorFullWidth ? "px-14" : "px-8",
                                page.icon ? "pt-4" : "pt-0",
                              )}
                            >
                              <div
                                className={cn(
                                  page.icon ? "-mb-1 mt-2" : "mt-1",
                                  isEditorFullWidth
                                    ? "max-w-full"
                                    : "w-full max-w-[720px] mx-auto",
                                )}
                              >
                                {!isLocalFolderPage && (
                                  <div
                                    className={cn(
                                      "group relative",
                                      !page.icon && "min-h-[20px] mb-2",
                                    )}
                                  >
                                    <IconSelector
                                      value={page.icon}
                                      onChange={(icon) =>
                                        !page.trashedAt &&
                                        !page.isLocked &&
                                        updatePage(activePageId, { icon })
                                      }
                                    >
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className={cn(
                                          "inline-flex h-auto w-auto p-0 items-center justify-start transition-all duration-300",
                                          page.icon
                                            ? "opacity-100 scale-100 [&_svg]:!size-[5.25rem] [&_svg]:stroke-[2.2]"
                                            : page.trashedAt || page.isLocked
                                              ? "opacity-0"
                                              : isNewPage
                                                ? "opacity-100 animate-slow-pulse hover:scale-105"
                                                : "opacity-0 group-hover:opacity-100 hover:scale-105",
                                          // 模态浮层（右键菜单/下拉菜单）打开时隐藏提示并暂停脉冲，
                                          // 避免菜单旁忽隐忽现的"幽灵阴影"
                                          !page.icon &&
                                            "[body[data-scroll-locked]_&]:!opacity-0 [body[data-scroll-locked]_&]:!animate-none",
                                        )}
                                      >
                                        {page.icon ? (
                                          (LucideIcons as any)[page.icon] ? (
                                            (() => {
                                              const Icon = (LucideIcons as any)[
                                                page.icon
                                              ];
                                              return <Icon />;
                                            })()
                                          ) : (
                                            <span className="text-[5.25rem] leading-none">
                                              {page.icon}
                                            </span>
                                          )
                                        ) : (
                                          <div className="flex items-center gap-1 text-sm text-muted-foreground hover:bg-muted px-2 py-1 rounded-md">
                                            <LucideIcons.Smile className="h-4 w-4" />
                                            <span>添加图标</span>
                                          </div>
                                        )}
                                      </Button>
                                    </IconSelector>
                                  </div>
                                )}
                              </div>

                              <ErrorBoundary
                                key={activePageId}
                                resetKey={activePageId}
                                fallback={(_, reset) => (
                                  <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                                    <p>当前页面渲染失败，已阻止整窗白屏。</p>
                                    <button
                                      type="button"
                                      onClick={reset}
                                      className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-[var(--goose-interactive-hover)]"
                                    >
                                      重试
                                    </button>
                                  </div>
                                )}
                              >
                                <Editor
                                  ref={editorRef}
                                  editable={!page.isLocked && !page.trashedAt}
                                />
                              </ErrorBoundary>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    {/* NotebookAiPanel 接线 */}
                    {aiAvailableForNotebook &&
                      aiPanelOpen &&
                      activeNotebookId && (
                        <NotebookAiPanel
                          key={activeNotebookId}
                          notebookId={activeNotebookId}
                          onClose={closeAiPanel}
                          editorRef={editorRef}
                          capturedSelection={aiPanelCapturedSelection}
                          onConsumeCapturedSelection={
                            consumeAiPanelCapturedSelection
                          }
                        />
                      )}
                  </div>
                </EditorHostBridge>
              </>
            ) : (
              <PageEmptyState />
            )}
          </main>
        </div>
      </div>
    </>
  );
}
