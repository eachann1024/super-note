import { FavoritesSection } from "./FavoritesSection";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarMainTree } from "./main-tree/SidebarMainTree";
import { SettingsDialog } from "./SettingsDialog";
import { TrashList } from "./TrashList";
import { useTabs } from "@/stores/useTabs";
import { useSidebarView } from "@/stores/useSidebarView";
import type { EditorRef } from "@/components/editor/core/Editor";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useSidebarItemHeight } from "./hooks/useSidebarItemHeight";
import { useSidebarEffects } from "./hooks/useSidebarEffects";
import { SidebarResizeEdge } from "./SidebarResizeEdge";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { SidebarRenameDialog, useRenameDialog } from "./SidebarRenameDialog";
import { SidebarOutline } from "./SidebarOutline";
import { HistoryVersionList } from "../history/HistoryView";
import { useHistoryView } from "@/stores/useHistoryView";

const SIDEBAR_SIDE_GAP_LEFT = 0;
const SIDEBAR_SIDE_GAP_RIGHT = 9;
const SIDEBAR_CONTENT_WIDTH_OFFSET = SIDEBAR_SIDE_GAP_LEFT + SIDEBAR_SIDE_GAP_RIGHT;

type SidebarView = "pages" | "trash" | "outline";
type SidebarDragGuideMode = "sort" | "nest-ready";

interface SidebarDragGuideState {
  direction: "left" | "right";
  mode: SidebarDragGuideMode;
}

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  disableResize?: boolean;
  selectedPageId?: string | null;
  editorRef?: React.RefObject<EditorRef | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function Sidebar({
  className,
  disableResize = false,
  selectedPageId,
  editorRef,
  scrollContainerRef,
}: SidebarProps) {
  const {
    activePageId,
    setActivePage,
    createPage,
    createLocalPage,
    getPage,
    setExpandPageId,
  } = usePages();
  const { activeNotebookId, notebooks } = useNotebooks();
  const { openInCurrentTab } = useTabs();
  const setExpanded = useSidebarView((s) => s.setExpanded);
  const sidebarCollapsed = useSidebarView((s) => s.sidebarCollapsed);
  const activeNotebook = activeNotebookId ? notebooks[activeNotebookId] : null;
  const isLocalFolder = activeNotebook?.source === "local-folder";

  const itemHeight = useSidebarItemHeight();
  const rowHeight = itemHeight + 1;
  const trashItemHeight = Math.max(itemHeight + 20, 48);

  const { width, isResizing, handleResizeMouseDown, handleResizePointerDown } =
    useSidebarResize({ disableResize });

  const [showSettings, setShowSettings] = useState(false);
  const [currentView, setCurrentView] = useState<SidebarView>("pages");
  const [dragGuide, setDragGuide] = useState<SidebarDragGuideState | null>(null);

  // 历史模式：临时整体替换 Sidebar 中段（页面树/大纲），但 Header/Footer 与
  // currentView/scrollAreaRef 等 state 保持，退出后页面树原状回到上次的滚动与选中。
  const historyActivePageId = useHistoryView((s) => s.active);
  const exitHistoryView = useHistoryView((s) => s.exit);
  const inHistoryMode =
    !!historyActivePageId && historyActivePageId === activePageId;

  const sidebarRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [scrollAreaHeight, setScrollAreaHeight] = useState(0);

  const {
    renameDialogOpen,
    setRenameDialogOpen,
    renameValue,
    setRenameValue,
    renamePageId,
    confirmRename,
  } = useRenameDialog();

  useSidebarEffects({
    activePageId,
    activeNotebookId,
    currentView,
    onOpenSettings: () => setShowSettings(true),
  });

  useEffect(() => {
    if (!scrollAreaRef.current) return;
    const updateHeight = () => {
      const height = scrollAreaRef.current?.clientHeight ?? 0;
      setScrollAreaHeight(height);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(scrollAreaRef.current);
    return () => observer.disconnect();
  }, []);

  const handleCreatePage = () => {
    if (!activeNotebookId) return;
    // 在当前所处页面的同级创建：取当前页的 parentId 作为新页的父级
    const basePageId = selectedPageId ?? activePageId;
    const basePage = basePageId ? getPage(basePageId) : undefined;
    const siblingParentId =
      basePage && basePage.workspaceId === activeNotebookId
        ? basePage.parentId
        : undefined;
    if (isLocalFolder) {
      void createLocalPage(siblingParentId, activeNotebookId);
      return;
    }
    const newPageId = createPage(siblingParentId, activeNotebookId);
    openInCurrentTab(newPageId);
    // 新页若落在折叠的父级下，展开祖先并聚焦使其可见
    if (siblingParentId) setExpandPageId(newPageId);
    window.dispatchEvent(new CustomEvent("goose-note:focus-editor-start"));
  };

  const handleSearch = () => {
    window.dispatchEvent(new CustomEvent("goose-note:open-search"));
  };

  return (
    <div
      ref={sidebarRef}
      className={cn(
        "pb-0 bg-[hsl(var(--goose-shell-bg))] h-full flex flex-col relative group/sidebar",
        isResizing
          ? "transition-[opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          : "transition-[width,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
        sidebarCollapsed && "pointer-events-none",
        className,
      )}
      style={{
        width: sidebarCollapsed ? 0 : width,
        minWidth: sidebarCollapsed ? 0 : undefined,
        opacity: sidebarCollapsed ? 0 : 1,
        overflow: sidebarCollapsed ? "hidden" : "visible",
      }}
      aria-hidden={sidebarCollapsed}
    >
      {!disableResize && !sidebarCollapsed && (
        <SidebarResizeEdge
          isResizing={isResizing}
          onMouseDown={handleResizeMouseDown}
          onPointerDown={handleResizePointerDown}
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden rounded-[inherit]">
        <SidebarHeader
          dragGuide={dragGuide}
          selectedPageId={selectedPageId}
          onOpenPinnedPage={() => {
            setCurrentView("pages");
            setShowSettings(false);
          }}
        />

        {inHistoryMode ? (
          <HistoryVersionList />
        ) : currentView === "trash" ? (
          <div className="flex-1 overflow-hidden">
            <TrashList showHeader={false} itemHeight={trashItemHeight} />
          </div>
        ) : (
          <>
            <FavoritesSection
              width={width - SIDEBAR_CONTENT_WIDTH_OFFSET}
              rowHeight={rowHeight}
              itemHeight={itemHeight}
              onCreatePage={handleCreatePage}
            />

            <div className="flex-1 min-h-0 flex flex-col">
              <div className="mt-1 shrink-0">
                <SidebarSectionHeader
                  title={isLocalFolder ? "本地" : "页面"}
                  onSearch={handleSearch}
                  onCreate={handleCreatePage}
                  createTitle={isLocalFolder ? "新建文件" : "新建页面"}
                  view={currentView}
                  onSwitchToPages={() => {
                    if (currentView === "pages" && activeNotebookId) {
                      setExpanded(activeNotebookId, []);
                    } else {
                      setCurrentView("pages");
                    }
                  }}
                  onSwitchToOutline={() => setCurrentView("outline")}
                />
              </div>
              {currentView === "pages" ? (
                <div ref={scrollAreaRef} className="pl-0 pr-[9px] flex-1 min-h-0 flex flex-col">
                  <SidebarMainTree
                    activeNotebookId={activeNotebookId}
                    selectedPageId={selectedPageId}
                    width={width - SIDEBAR_CONTENT_WIDTH_OFFSET}
                    rowHeight={rowHeight}
                    itemHeight={itemHeight}
                    viewportHeight={scrollAreaHeight}
                    onCreatePage={handleCreatePage}
                  />
                </div>
              ) : (
                <div className="pl-0 pr-[9px] flex-1 min-h-0 overflow-hidden">
                  <SidebarOutline
                    editorRef={editorRef}
                    scrollContainerRef={scrollContainerRef}
                    pageId={activePageId}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <SidebarFooter
        currentView={currentView}
        isSettingsOpen={showSettings}
        onSwitchToTrash={() => {
          // 再点一次回收箱图标即返回页面视图（回收箱视图隐藏了页面/大纲分区头，
          // 没有别的返回入口，靠这个图标做开关，避免卡在回收箱里出不来）。
          if (currentView === "trash") {
            setCurrentView("pages");
            return;
          }
          if (inHistoryMode) exitHistoryView();
          setCurrentView("trash");
          setShowSettings(false);
          setActivePage(null);
        }}
        onOpenSettings={() => {
          if (inHistoryMode) exitHistoryView();
          setShowSettings(true);
        }}
      />

      <SidebarRenameDialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          setRenameDialogOpen(open);
        }}
        renamePageId={renamePageId}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        isLocalFolder={isLocalFolder}
        onConfirm={() => { void confirmRename(); }}
      />

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}
