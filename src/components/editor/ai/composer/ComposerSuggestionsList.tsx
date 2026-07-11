import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import * as LucideIcons from "lucide-react";
import { cn } from "@/components/editor/utils/cn";
import type { AiReferenceSuggestionItem } from "@/components/editor/ai/composer/referenceLookup";

interface ComposerSuggestionsListProps {
  items: AiReferenceSuggestionItem[];
  activeIndex: number;
  anchorRect: DOMRect;
  onSelect: (item: AiReferenceSuggestionItem) => void;
  onMouseDownCapture?: () => void;
}

const POPOVER_MAX_HEIGHT = 240;
const POPOVER_EMPTY_HEIGHT = 36;
const GAP = 4;

export function ComposerSuggestionsList({
  items,
  activeIndex,
  anchorRect,
  onSelect,
  onMouseDownCapture,
}: ComposerSuggestionsListProps) {
  const estimatedHeight =
    items.length === 0 ? POPOVER_EMPTY_HEIGHT : Math.min(POPOVER_MAX_HEIGHT, items.length * 40 + 8);

  const spaceBelow = window.innerHeight - anchorRect.bottom - GAP;
  const spaceAbove = anchorRect.top - GAP;
  const placeAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

  const style: CSSProperties = {
    position: "fixed",
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 320 - 8)),
    zIndex: 9999,
    minWidth: 220,
    maxWidth: 320,
    ...(placeAbove
      ? { bottom: window.innerHeight - anchorRect.top + GAP }
      : { top: anchorRect.bottom + GAP }),
  };

  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.querySelector<HTMLElement>(`[data-mention-index="${activeIndex}"]`);
    if (!activeEl) return;

    // Manual scroll with breathing room — scrollIntoView({ block: "nearest" })
    // glues the active item flush to the edge, which looks cramped.
    const padding = 8;
    const itemTop = activeEl.offsetTop;
    const itemBottom = itemTop + activeEl.offsetHeight;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;

    if (itemTop < viewTop + padding) {
      list.scrollTop = Math.max(0, itemTop - padding);
    } else if (itemBottom > viewBottom - padding) {
      list.scrollTop = itemBottom - list.clientHeight + padding;
    }
  }, [activeIndex, items.length]);

  const popover = (
    <div
      style={style}
      className="overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
      onMouseDownCapture={(e) => {
        e.preventDefault();
        onMouseDownCapture?.();
      }}
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">未找到匹配笔记</div>
      ) : (
        <ul ref={listRef} className="max-h-[240px] overflow-y-auto p-1">
          {items.map((item, index) => (
            <li key={item.pageId} data-mention-index={index}>
              <button
                type="button"
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]",
                  index === activeIndex
                    ? "bg-[var(--goose-interactive-selected)] text-[hsl(var(--foreground))]"
                    : "hover:bg-[var(--goose-interactive-hover)] hover:text-[hsl(var(--foreground))]",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(item);
                }}
              >
                {item.isFolder ? (
                  <LucideIcons.Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <LucideIcons.FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{item.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{item.description}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return createPortal(popover, document.body);
}
