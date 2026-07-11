/**
 * TreeRow.tsx
 * 侧边树单行组件集合：
 *  - SortablePageRow：可排序/拖拽的页面行
 *  - EdgeDropZone：顶/底边缘拖放区
 *  - PlaceholderRow：空文件夹占位行
 */
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as LucideIcons from "lucide-react";
import { useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { useSettings } from "@/stores/useSettings";
import { openPageFromSidebar } from "@/lib/sidebarPageNavigation";
import { useTabs } from "@/stores/useTabs";
import type { FlatTreeItem } from "../tree-dnd";
import { IconSelector } from "../../shared/IconSelector";
import { InlineOverflowRevealText } from "../InlineOverflowRevealText";
import { SidebarContextMenu } from "../SidebarContextMenu";
import { LocalFileIcon } from "../local-file-icon";
import { TREE_INDENT } from "./useTreeDnd";

const DEFAULT_NOTEBOOK = "default-notebook";

// ─── EdgeDropZone ─────────────────────────────────────────────────────────

export function EdgeDropZone({
  id,
  top,
  height,
}: {
  id: string;
  top: number;
  height: number;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className="pointer-events-none absolute left-0 right-0"
      style={{ top, height }}
    />
  );
}

// ─── PlaceholderRow ───────────────────────────────────────────────────────

export function PlaceholderRow({
  style,
  depth,
  name,
}: {
  style: CSSProperties;
  depth: number;
  name: string;
}) {
  return (
    <div style={style} className="relative px-0 select-none">
      <div className="flex items-center h-full pl-1 pr-2 rounded-md">
        <div
          style={{ paddingLeft: depth * TREE_INDENT + 24 }}
          className="text-[13px] text-muted-foreground/45 dark:text-muted-foreground/35 italic truncate"
        >
          {name}
        </div>
      </div>
    </div>
  );
}

// ─── SortablePageRow ──────────────────────────────────────────────────────

export interface SortablePageRowProps {
  item: FlatTreeItem;
  rowStyle: CSSProperties;
  depth: number;
  itemHeight: number;
  isLocalNotebook: boolean;
  isActive: boolean;
  isNestDropTarget: boolean;
  showDropLine: boolean;
  dropLinePosition: "top" | "bottom";
  dropLineLeft: number;
  onToggleOpen: (id: string) => void;
  showAddChildButton: boolean;
  dragEnabled: boolean;
  titleText: string;
  expandedTitleText?: string;
  revealResetSignal: number;
  titleRevealDisabled: boolean;
}

export function SortablePageRow({
  item,
  rowStyle,
  depth,
  itemHeight,
  isLocalNotebook,
  isActive,
  isNestDropTarget,
  showDropLine,
  dropLinePosition,
  dropLineLeft,
  onToggleOpen,
  showAddChildButton,
  dragEnabled,
  titleText,
  expandedTitleText,
  revealResetSignal,
  titleRevealDisabled,
}: SortablePageRowProps) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: item.id, disabled: !dragEnabled });
  const guardedListeners = dragEnabled
    ? {
        ...listeners,
        onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.button !== 0 || event.ctrlKey) return;
          listeners?.onPointerDown?.(event);
        },
      }
    : undefined;
  const sortableHandlers = dragEnabled
    ? {
        ...attributes,
        ...(guardedListeners ?? {}),
      }
    : {};

  const createPage = usePages((state) => state.createPage);
  const createLocalPage = usePages((state) => state.createLocalPage);
  const updatePage = usePages((state) => state.updatePage);
  const activeNotebookId = useNotebooks((state) => state.activeNotebookId);
  const openInCurrentTab = useTabs((state) => state.openInCurrentTab);

  const hideExpandArrows = useSettings((s) => s.hideExpandArrows);
  const page = item.page;
  const hasChildren = item.hasChildren;
  const showArrow = hasChildren;
  const isLocalFolder = isLocalNotebook;
  const iconName = page.icon;

  const dndTransform = CSS.Transform.toString(transform);
  const virtualTransform = typeof rowStyle.transform === "string" ? rowStyle.transform : "";
  const mergedTransform = isDragging && dndTransform
    ? `${virtualTransform} ${dndTransform}`.trim()
    : virtualTransform;
  const [titleExpanded, setTitleExpanded] = useState(false);
  const rowClickTimerRef = useRef<number | null>(null);

  const handleAddChild = (e: MouseEvent) => {
    e.stopPropagation();

    if (isLocalFolder) {
      void createLocalPage(page.id, activeNotebookId || undefined);
      if (!item.isOpen) {
        onToggleOpen(page.id);
      }
      return;
    }

    const currentPages = usePages.getState().pages;
    const existingBlankChild = Object.values(currentPages).find((p) => {
      const isChild = p.parentId === page.id && !p.trashedAt;
      const title = getPageTitle(p);
      const isBlankTitle = !title || title.trim() === "" || title === "无标题";
      const isBlankContent =
        !p.content ||
        p.content.type !== "doc" ||
        !p.content.content ||
        p.content.content.length === 0 ||
        (p.content.content.length === 1 &&
          p.content.content[0].type === "paragraph" &&
          (!p.content.content[0].content ||
            p.content.content[0].content.length === 0));
      return isChild && isBlankTitle && isBlankContent;
    });

    if (existingBlankChild) {
      if (!item.isOpen) {
        onToggleOpen(page.id);
      }
      openInCurrentTab(existingBlankChild.id);
      window.dispatchEvent(new CustomEvent("goose-note:focus-editor-start"));
      return;
    }

    if (!item.isOpen) {
      onToggleOpen(page.id);
    }
    const newId = createPage(page.id, activeNotebookId || DEFAULT_NOTEBOOK);
    openInCurrentTab(newId);
  };

  const handleArrowPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!showArrow) return;
    if (event.button !== 0 || event.ctrlKey) return;
    onToggleOpen(page.id);
  };

  const handleArrowClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // Keyboard-triggered click has detail=0.
    if (event.detail === 0 && showArrow) {
      onToggleOpen(page.id);
    }
  };

  const handleHiddenArrowPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!hasChildren) return;
    if (event.button !== 0 || event.ctrlKey) return;
    onToggleOpen(page.id);
  };

  const handleHiddenArrowClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.detail === 0 && hasChildren) {
      onToggleOpen(page.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...rowStyle,
        height: itemHeight,
        transform: mergedTransform,
        transition,
      }}
      className={cn("group relative px-0", isDragging && "z-20 pointer-events-none")}
    >
      {isNestDropTarget && (
        <div className="pointer-events-none absolute -inset-x-0.5 -inset-y-[2px] z-10 rounded-[10px] bg-[hsl(var(--primary)/0.18)] ring-1 ring-[hsl(var(--primary)/0.52)] shadow-[0_0_0_1px_hsl(var(--background)/0.5)_inset] transition-all duration-100" />
      )}
      {showDropLine && (
        <div
          className="pointer-events-none absolute z-[35] h-[2px] rounded-full bg-[hsl(var(--primary))] shadow-[0_0_8px_hsl(var(--primary)/0.35)] transition-all duration-100"
          style={{
            left: dropLineLeft,
            right: 12,
            top: dropLinePosition === "top" ? 0 : undefined,
            bottom: dropLinePosition === "bottom" ? 0 : undefined,
          }}
        />
      )}

      <SidebarContextMenu page={page}>
        <div
          data-goose-context-trigger="true"
          {...sortableHandlers}
          className={cn(
            "relative z-20 flex items-center h-full pl-0 pr-1 rounded-[8px] overflow-hidden cursor-pointer transition-colors text-sm font-medium",
            isNestDropTarget && "sidebar-drop-parent-target",
            isDragging && "opacity-60 cursor-grabbing",
            !isActive &&
              "text-muted-foreground dark:text-muted-foreground/65 hover:bg-[var(--goose-interactive-hover)] hover:text-foreground dark:hover:text-foreground/92 transition-colors duration-200",
            isActive &&
              "bg-[var(--goose-interactive-selected)] text-foreground"
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (rowClickTimerRef.current !== null) {
              window.clearTimeout(rowClickTimerRef.current);
            }
            const openInNewTab = e.metaKey || e.ctrlKey;
            rowClickTimerRef.current = window.setTimeout(() => {
              rowClickTimerRef.current = null;
              if (openInNewTab) {
                openPageFromSidebar(page.id, "permanent");
              } else {
                openPageFromSidebar(page.id, "preview");
              }
            }, 220);
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (rowClickTimerRef.current !== null) {
              window.clearTimeout(rowClickTimerRef.current);
              rowClickTimerRef.current = null;
            }
            openPageFromSidebar(page.id, "permanent");
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              e.stopPropagation();
              openPageFromSidebar(page.id, "permanent");
            }
          }}
        >
          <div
            className="flex items-center h-full flex-1 min-w-0"
            style={{ paddingLeft: depth * TREE_INDENT }}
          >
            {hideExpandArrows ? null : (
              <button
                type="button"
                aria-label={item.isOpen ? "折叠子页面" : "展开子页面"}
                aria-expanded={item.isOpen}
                className={cn(
                  "ml-1.5 flex items-center justify-center w-5 h-5 shrink-0 rounded border-0 bg-transparent p-0 transition-all duration-300 ease-out",
                  showArrow
                    ? "hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] cursor-pointer"
                    : "opacity-0 pointer-events-none"
                )}
                onPointerDown={handleArrowPointerDown}
                onClick={handleArrowClick}
              >
                <LucideIcons.ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground/80 transition-transform duration-200",
                    item.isOpen && "rotate-90"
                  )}
                />
              </button>
            )}

            {hideExpandArrows ? (
              hasChildren ? (
                <button
                  type="button"
                  aria-label={item.isOpen ? "折叠子项" : "展开子项"}
                  aria-expanded={item.isOpen}
                  className="group/hidden-toggle relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] mr-0.5 transition-colors duration-150 hover:bg-[var(--goose-icon-chip-on-selected)] focus-visible:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] dark:focus-visible:bg-[var(--goose-interactive-hover)]"
                  onPointerDown={handleHiddenArrowPointerDown}
                  onClick={handleHiddenArrowClick}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <span className="flex h-4 w-4 items-center justify-center transition-opacity duration-150 group-hover:opacity-0 group-focus-visible/hidden-toggle:opacity-0">
                    <LocalFileIcon
                      page={page}
                      iconName={iconName}
                      isLocalFolder={isLocalFolder}
                      hasChildren={hasChildren}
                    />
                  </span>
                  <LucideIcons.ChevronRight
                    className={cn(
                      "pointer-events-none absolute h-3.5 w-3.5 text-muted-foreground/80 opacity-0 transition-[opacity,transform] duration-150 group-hover:opacity-100 group-focus-visible/hidden-toggle:opacity-100",
                      item.isOpen && "rotate-90",
                    )}
                  />
                </button>
              ) : (
                <div className="pointer-events-none flex h-6 w-6 shrink-0 items-center justify-center mr-0.5">
                  <div className="flex h-4 w-4 items-center justify-center">
                    <LocalFileIcon
                      page={page}
                      iconName={iconName}
                      isLocalFolder={isLocalFolder}
                      hasChildren={hasChildren}
                    />
                  </div>
                </div>
              )
            ) : (
              <div
                className="flex items-center justify-center w-5 h-5 shrink-0 mr-0.5 select-none"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {isLocalFolder ? (
                  <div className="flex items-center justify-center w-5 h-5">
                    <LocalFileIcon
                      page={page}
                      iconName={iconName}
                      isLocalFolder={isLocalFolder}
                      hasChildren={hasChildren}
                    />
                  </div>
                ) : (
                <IconSelector
                  value={iconName}
                  onChange={(newIcon) => updatePage(page.id, { icon: newIcon as string })}
                >
                  <div className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] transition-colors cursor-pointer">
                    <div className="h-4 w-4 flex items-center justify-center">
                      <LocalFileIcon
                        page={page}
                        iconName={iconName}
                        isLocalFolder={false}
                        hasChildren={hasChildren}
                      />
                    </div>
                  </div>
                </IconSelector>
                )}
              </div>
            )}

            <InlineOverflowRevealText
              className="text-sm"
              text={titleText}
              expandedText={expandedTitleText}
              active={isActive}
              disabled={titleRevealDisabled}
              resetSignal={revealResetSignal}
              onExpandedChange={setTitleExpanded}
            />
          </div>

          {showAddChildButton && (
            <div
              className={cn(
                "ml-1 items-center shrink-0",
                titleExpanded
                  ? "hidden"
                  : isNestDropTarget
                    ? "flex"
                    : "hidden group-hover:flex"
              )}
            >
              {isNestDropTarget && (
                <span className="mr-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary bg-[hsl(var(--primary)/0.14)]">
                  松手移入子页面
                </span>
              )}
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
                onClick={handleAddChild}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <LucideIcons.Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </SidebarContextMenu>
    </div>
  );
}
