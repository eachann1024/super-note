import { useCallback, useEffect, useRef, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { AlertCircle, FileText, RotateCcw } from "lucide-react";
import { postToHost } from "../lib/bridge";
import type {
  EditorDraft,
  EditorFont,
  EditorPagePayload,
  EditorPreferences,
  SaveAcknowledgement,
} from "../lib/types";

const EMPTY_CONTENT: PartialBlock[] = [{ type: "paragraph", content: [] }];
type SaveVisualState = "idle" | "saving" | "saved" | "failed" | "conflict";

function createRequestID() {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

async function fileToDataURL(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024) throw new Error("单个附件不能超过 8 MB");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("无法读取附件"));
    reader.readAsDataURL(file);
  });
}

export function EditorSurface() {
  const editor = useCreateBlockNote({ uploadFile: fileToDataURL });
  const [pageID, setPageID] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [appearance, setAppearance] = useState<"light" | "dark">("light");
  const [font, setFont] = useState<EditorFont>("sans");
  const [fullWidth, setFullWidth] = useState(false);
  const [saveState, setSaveState] = useState<SaveVisualState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceMarkdown, setSourceMarkdown] = useState("");

  const pageIDRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const revisionRef = useRef(0);
  const generationRef = useRef(0);
  const dirtyVersionRef = useRef(0);
  const lastSentDirtyVersionRef = useRef(0);
  const pendingRequestRef = useRef<string | null>(null);
  const pendingMarkdownRef = useRef("");
  const originalMarkdownRef = useRef("");
  const sourceMarkdownRef = useRef("");
  const sourceModeRef = useRef(false);
  const pendingWaitersRef = useRef<Array<() => void>>([]);
  const saveTimerRef = useRef<number | null>(null);
  const applyingHostPageRef = useRef(false);
  const commitDraftRef = useRef<() => Promise<void>>(async () => undefined);
  const composingRef = useRef(false);
  const readyPostedRef = useRef(false);

  const focusEditor = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(
          sourceModeRef.current ? ".markdown-source" : '.bn-editor [contenteditable="true"]',
        ) ?? document.querySelector<HTMLElement>(".bn-editor");
        target?.focus({ preventScroll: true });
      });
    });
  }, []);

  const markDirty = useCallback(() => {
    if (!pageIDRef.current) return;
    dirtyVersionRef.current += 1;
    setSaveState("saving");
    postToHost({ version: 1, type: "dirty", pageID: pageIDRef.current });
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void commitDraftRef.current();
    }, 360);
  }, []);

  const markEditorDirty = useCallback(() => {
    if (applyingHostPageRef.current) return;
    markDirty();
  }, [markDirty]);

  const buildDraft = useCallback(async (): Promise<EditorDraft> => {
    const hasChanges = dirtyVersionRef.current > 0;
    const markdown = !hasChanges
      ? originalMarkdownRef.current
      : sourceModeRef.current
        ? sourceMarkdownRef.current
        : await editor.blocksToMarkdownLossy(editor.document);
    return {
      version: 1,
      requestID: createRequestID(),
      pageID: pageIDRef.current ?? "",
      baseRevision: revisionRef.current,
      title: titleRef.current,
      markdown,
      hasChanges,
    };
  }, [editor]);

  const commitDraft = useCallback(async () => {
    if (!pageIDRef.current || pendingRequestRef.current || composingRef.current) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const draft = await buildDraft();
    pendingRequestRef.current = draft.requestID;
    pendingMarkdownRef.current = draft.markdown;
    lastSentDirtyVersionRef.current = dirtyVersionRef.current;
    setSaveState("saving");
    postToHost({ ...draft, type: "change" });
  }, [buildDraft]);
  commitDraftRef.current = commitDraft;

  const waitForPending = useCallback(async () => {
    if (!pendingRequestRef.current) return;
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 1800);
      pendingWaitersRef.current.push(() => {
        window.clearTimeout(timeout);
        resolve();
      });
    });
  }, []);

  const applyPreferences = useCallback((preferences: EditorPreferences) => {
    setAppearance(preferences.appearance);
    setFont(preferences.editorFont);
    setFullWidth(preferences.fullWidth);
    document.documentElement.dataset.theme = preferences.appearance;
    document.documentElement.dataset.editorFont = preferences.editorFont;
    document.documentElement.dataset.fullWidth = String(preferences.fullWidth);
    document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion);
    document.documentElement.dataset.increaseContrast = String(preferences.increaseContrast);
    document.documentElement.style.colorScheme = preferences.appearance;
  }, []);

  const receivePage = useCallback(async (page: EditorPagePayload) => {
    if (page.version !== 1 || page.generation < generationRef.current) return;
    generationRef.current = page.generation;
    pageIDRef.current = page.pageID;
    revisionRef.current = page.revision;
    titleRef.current = page.title;
    originalMarkdownRef.current = page.markdown;
    sourceMarkdownRef.current = page.markdown;
    sourceModeRef.current = false;
    pendingRequestRef.current = null;
    dirtyVersionRef.current = 0;
    lastSentDirtyVersionRef.current = 0;
    pendingWaitersRef.current.splice(0).forEach((resolve) => resolve());
    setPageID(page.pageID);
    setTitle(page.title);
    setSaveState("idle");
    setErrorMessage("");
    applyPreferences(page);
    applyingHostPageRef.current = true;
    editor.replaceBlocks(editor.document, EMPTY_CONTENT);
    const blocks = await editor.tryParseMarkdownToBlocks(page.markdown);
    if (page.generation !== generationRef.current) return;
    const nextContent = blocks.length ? blocks : EMPTY_CONTENT;
    const roundTrippedMarkdown = await editor.blocksToMarkdownLossy(nextContent);
    if (page.generation !== generationRef.current) return;
    const normalizeForComparison = (value: string) => value
      .replace(/\r\n/g, "\n")
      .replace(/\n+$/g, "");
    const shouldUseSourceMode = page.markdown.length > 0
      && normalizeForComparison(roundTrippedMarkdown) !== normalizeForComparison(page.markdown);
    sourceModeRef.current = shouldUseSourceMode;
    setSourceMode(shouldUseSourceMode);
    setSourceMarkdown(page.markdown);
    editor.replaceBlocks(editor.document, nextContent);
    window.requestAnimationFrame(() => {
      if (page.generation === generationRef.current) applyingHostPageRef.current = false;
    });
    focusEditor();
  }, [applyPreferences, editor, focusEditor]);

  const receiveAcknowledgement = useCallback((acknowledgement: SaveAcknowledgement) => {
    if (acknowledgement.version !== 1 || acknowledgement.pageID !== pageIDRef.current) return;
    if (acknowledgement.requestID !== pendingRequestRef.current) return;
    pendingRequestRef.current = null;
    revisionRef.current = acknowledgement.revision;
    pendingWaitersRef.current.splice(0).forEach((resolve) => resolve());

    if (acknowledgement.status === "saved") {
      const changedAfterSend = dirtyVersionRef.current !== lastSentDirtyVersionRef.current;
      originalMarkdownRef.current = pendingMarkdownRef.current;
      if (!changedAfterSend) {
        dirtyVersionRef.current = 0;
        lastSentDirtyVersionRef.current = 0;
      }
      setSaveState(changedAfterSend ? "saving" : "saved");
      setErrorMessage("");
      if (changedAfterSend) {
        saveTimerRef.current = window.setTimeout(() => void commitDraft(), 120);
      }
      return;
    }

    setErrorMessage(acknowledgement.message ?? "保存失败，请重试。 ");
    setSaveState(acknowledgement.status === "conflict" ? "conflict" : "failed");
  }, [commitDraft]);

  const dispatchCommand = useCallback((command: { name: string }) => {
    if (!pageIDRef.current || sourceModeRef.current) return;
    const cursor = editor.getTextCursorPosition();
    switch (command.name) {
      case "bold": editor.toggleStyles({ bold: true }); break;
      case "italic": editor.toggleStyles({ italic: true }); break;
      case "strike": editor.toggleStyles({ strike: true }); break;
      case "code": editor.toggleStyles({ code: true }); break;
      case "heading1": editor.updateBlock(cursor.block, { type: "heading", props: { level: 1 } }); break;
      case "heading2": editor.updateBlock(cursor.block, { type: "heading", props: { level: 2 } }); break;
      case "heading3": editor.updateBlock(cursor.block, { type: "heading", props: { level: 3 } }); break;
      case "bulletList": editor.updateBlock(cursor.block, { type: "bulletListItem" }); break;
      case "numberedList": editor.updateBlock(cursor.block, { type: "numberedListItem" }); break;
      case "checkList": editor.updateBlock(cursor.block, { type: "checkListItem" }); break;
      case "blockquote": editor.updateBlock(cursor.block, { type: "quote" }); break;
      case "link": {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
        break;
      }
      default: break;
    }
    markDirty();
  }, [editor, markDirty]);

  useEffect(() => {
    window.gooseEditor = {
      receivePage,
      receiveAcknowledgement,
      updatePreferences: applyPreferences,
      clear: () => {
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        pageIDRef.current = null;
        pendingRequestRef.current = null;
        pendingMarkdownRef.current = "";
        originalMarkdownRef.current = "";
        sourceMarkdownRef.current = "";
        sourceModeRef.current = false;
        pendingWaitersRef.current.splice(0).forEach((resolve) => resolve());
        setPageID(null);
        setSourceMode(false);
        setSourceMarkdown("");
        setSaveState("idle");
        setErrorMessage("");
      },
      dispatchCommand,
      focusEditor,
      flushAndGetDraft: async () => {
        if (saveTimerRef.current) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        await waitForPending();
        return await buildDraft();
      },
    };
    if (!readyPostedRef.current) {
      readyPostedRef.current = true;
      postToHost({ version: 1, type: "ready" });
    }
  }, [applyPreferences, buildDraft, dispatchCommand, editor, focusEditor, receiveAcknowledgement, receivePage, waitForPending]);

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
  }, []);

  const updateTitle = (value: string) => {
    titleRef.current = value;
    setTitle(value);
    markDirty();
  };

  const updateSourceMarkdown = (value: string) => {
    sourceMarkdownRef.current = value;
    setSourceMarkdown(value);
    markDirty();
  };

  const retry = () => {
    setErrorMessage("");
    setSaveState("saving");
    void commitDraft();
  };

  const reload = () => {
    if (!pageIDRef.current) return;
    postToHost({ version: 1, type: "reloadRequest", pageID: pageIDRef.current });
  };

  return (
    <main
      className={`editor-surface editor-font-${font}${fullWidth ? " is-full-width" : ""}`}
      data-theme={appearance}
      data-testid="editor-surface"
    >
      {pageID ? (
        <>
          {(saveState === "failed" || saveState === "conflict") && (
            <div className="save-error" role="alert" data-testid="save-error">
              <AlertCircle aria-hidden="true" size={17} />
              <span>{errorMessage}</span>
              <button type="button" onClick={saveState === "conflict" ? reload : retry}>
                <RotateCcw aria-hidden="true" size={14} />
                {saveState === "conflict" ? "重新载入" : "重试"}
              </button>
            </div>
          )}
          <article className="editor-page" aria-label="当前页面" data-testid="editor-document">
            <span className="page-icon" aria-hidden="true"><FileText size={29} /></span>
            <textarea
              className="page-title"
              value={title}
              rows={1}
              aria-label="文件名"
              placeholder="未命名"
              spellCheck
              onChange={(event) => updateTitle(event.target.value)}
              onInput={(event) => {
                const field = event.currentTarget;
                field.style.height = "auto";
                field.style.height = `${field.scrollHeight}px`;
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => {
                composingRef.current = false;
                markDirty();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                focusEditor();
              }}
            />
            {sourceMode ? (
              <>
                <p className="source-mode-notice" role="status">
                  此文件包含富文本编辑器无法无损保留的 Markdown，已切换为源码编辑以保护原文。
                </p>
                <textarea
                  className="markdown-source"
                  aria-label="Markdown 源码"
                  value={sourceMarkdown}
                  spellCheck={false}
                  onChange={(event) => updateSourceMarkdown(event.target.value)}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => {
                    composingRef.current = false;
                    markDirty();
                  }}
                />
              </>
            ) : (
              <BlockNoteView
                editor={editor}
                theme={appearance}
                onChange={markEditorDirty}
              />
            )}
          </article>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {saveState === "saving" ? "正在保存" : saveState === "saved" ? "已保存" : ""}
          </p>
        </>
      ) : (
        <div className="editor-placeholder" aria-label="未打开文件">
          <FileText aria-hidden="true" size={34} />
          <p>新建或打开 Markdown 文件开始写作</p>
        </div>
      )}
    </main>
  );
}
