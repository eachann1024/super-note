import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  type AiFileReferenceAttrs,
  type AiReferenceSuggestionItem,
} from "./referenceLookup";
import { useEditorPageContext } from "@/components/editor/platform/hostContext";

interface DetectedMention {
  query: string;
  range: Range;
}

interface MentionState {
  active: boolean;
  query: string;
  anchorRect: DOMRect | null;
  activeIndex: number;
}

interface UseReferenceMentionsOptions {
  editorRef: RefObject<HTMLDivElement | null>;
  isComposingRef: RefObject<boolean>;
  onContentMutation: () => void;
  onReferenceAdded?: (reference: AiFileReferenceAttrs) => void;
  searchPages?: (query: string) => AiReferenceSuggestionItem[];
}

const INACTIVE_MENTION: MentionState = {
  active: false,
  query: "",
  anchorRect: null,
  activeIndex: 0,
};

function detectMentionAtCaret(container: HTMLElement): DetectedMention | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed) return null;

  const anchor = selection.anchorNode;
  if (!anchor || anchor.nodeType !== Node.TEXT_NODE) return null;
  if (!container.contains(anchor)) return null;

  const text = anchor.textContent ?? "";
  const offset = selection.anchorOffset;
  const beforeCaret = text.slice(0, offset);

  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex === -1) return null;

  if (atIndex > 0 && !/[\s\n]/.test(beforeCaret[atIndex - 1])) return null;

  const query = beforeCaret.slice(atIndex + 1);
  if (/[\s\n]/.test(query)) return null;

  const range = document.createRange();
  range.setStart(anchor, atIndex);
  range.setEnd(anchor, offset);

  return { query, range };
}

export function createChipElement(attrs: AiFileReferenceAttrs): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.aiMentionId = attrs.pageId;
  span.dataset.aiMentionAttrs = JSON.stringify(attrs);
  span.className =
  "inline-flex items-center mx-1 rounded px-1 py-0 text-[11px] font-medium" +
    " bg-[var(--goose-interactive-selected)] text-[hsl(var(--foreground))] border border-border" +
    " cursor-pointer hover:bg-[var(--goose-interactive-hover)] select-none align-middle leading-5";
  span.textContent = `@${attrs.titleSnapshot}`;
  return span;
}

export function useReferenceMentions({
  editorRef,
  isComposingRef,
  onContentMutation,
  onReferenceAdded,
  searchPages: searchPagesOverride,
}: UseReferenceMentionsOptions) {
  const { searchPages } = useEditorPageContext();
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDetectedRef = useRef<DetectedMention | null>(null);
  const [mention, setMention] = useState<MentionState>(INACTIVE_MENTION);

  const mentionItems = useMemo(
    () =>
      mention.active
        ? (searchPagesOverride ?? searchPages)(mention.query).filter(
            (item) => !item.isFolder,
          )
        : [],
    [mention.active, mention.query, searchPages, searchPagesOverride],
  );

  // Keep a ref so keyboard handler always sees current items without stale closure
  const mentionItemsRef = useRef(mentionItems);
  useEffect(() => {
    mentionItemsRef.current = mentionItems;
  }, [mentionItems]);

  const clearMentionState = useCallback(() => {
    lastDetectedRef.current = null;
    setMention(INACTIVE_MENTION);
  }, []);

  const detectMention = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    if (isComposingRef.current) return;

    const detected = detectMentionAtCaret(el);
    if (detected) {
      lastDetectedRef.current = detected;
      const rect = detected.range.getBoundingClientRect();
      setMention((prev) => ({
        active: true,
        query: detected.query,
        anchorRect: rect,
        activeIndex: detected.query !== prev.query ? 0 : prev.activeIndex,
      }));
    } else {
      lastDetectedRef.current = null;
      setMention((prev) => (prev.active ? INACTIVE_MENTION : prev));
    }
  }, [editorRef, isComposingRef]);

  const insertMention = useCallback(
    (item: AiReferenceSuggestionItem) => {
      const el = editorRef.current;
      if (!el) return;

      setMention(INACTIVE_MENTION);

      // Prefer the range captured at detection time — by the time we get here,
      // React may have re-rendered (popover mounting) and Chromium can reset the
      // live selection's anchor to the contenteditable container, which would
      // make a fresh detectMentionAtCaret() return null.
      const detected = lastDetectedRef.current ?? detectMentionAtCaret(el);
      lastDetectedRef.current = null;
      if (!detected) return;

      const chip = createChipElement(item);
      const spacer = document.createTextNode(" ");
      try {
        detected.range.deleteContents();
        // Insert chip + spacer as one fragment so range state after insertNode
        // doesn't affect spacer placement.
        const frag = document.createDocumentFragment();
        frag.appendChild(chip);
        frag.appendChild(spacer);
        detected.range.insertNode(frag);
      } catch {
        return;
      }

      // Focus BEFORE placing the cursor — calling focus() after addRange()
      // resets the selection in some browsers.
      el.focus();
      const sel = window.getSelection();
      if (sel) {
        const r = document.createRange();
        r.setStart(spacer, spacer.length);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }

      onContentMutation();
      onReferenceAdded?.(item);
    },
    [editorRef, onContentMutation, onReferenceAdded],
  );

  const handleMentionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!mention.active) return false;

      const items = mentionItemsRef.current;
      const count = Math.max(1, items.length);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMention((prev) => ({ ...prev, activeIndex: (prev.activeIndex + 1) % count }));
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMention((prev) => ({
          ...prev,
          activeIndex: (prev.activeIndex - 1 + count) % count,
        }));
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const item = items[mention.activeIndex];
        if (item) {
          insertMention(item);
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(INACTIVE_MENTION);
        return true;
      }

      return false;
    },
    [mention.active, mention.activeIndex, insertMention],
  );

  const handleMentionBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => {
      setMention(INACTIVE_MENTION);
    }, 150);
  }, []);

  const cancelMentionBlurTimer = useCallback(() => {
    if (blurTimerRef.current !== null) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }, []);

  return {
    mention,
    mentionItems,
    detectMention,
    insertMention,
    handleMentionKeyDown,
    handleMentionBlur,
    cancelMentionBlurTimer,
    clearMentionState,
  };
}
