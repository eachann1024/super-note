/**
 * 面板开关状态持久化（按入口独立）
 */
import { useState, useCallback } from "react";

const STORAGE_KEY = "goose-note-ai-panel-open";

export interface NotebookAiPanelSelectionCapture<TSelection = unknown> {
  version: 1;
  pageId: string;
  selection: TSelection;
}

/** 无记录或读失败时视为关闭（默认不打开 AI 面板）。 */
function readStoredOpen(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "true";
  } catch {
    // localStorage 在隐私模式或受限 WebView 中可能不可用。
  }
  return false;
}

export function useNotebookAiPanel() {
  const [isOpen, setIsOpen] = useState<boolean>(readStoredOpen);
  const [capturedSelection, setCapturedSelection] =
    useState<NotebookAiPanelSelectionCapture | null>(null);

  const open = useCallback(
    (capture?: NotebookAiPanelSelectionCapture | null) => {
      setCapturedSelection(capture ?? null);
      setIsOpen(true);
      try {
        localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        // localStorage 在隐私模式或受限 WebView 中可能不可用。
      }
    },
    [],
  );

  const close = useCallback(() => {
    setCapturedSelection(null);
    setIsOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "false");
    } catch {
      // localStorage 在隐私模式或受限 WebView 中可能不可用。
    }
  }, []);

  const toggle = useCallback(() => {
    setCapturedSelection(null);
    setIsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage 在隐私模式或受限 WebView 中可能不可用。
      }
      return next;
    });
  }, []);

  const consumeCapturedSelection = useCallback(() => {
    setCapturedSelection(null);
  }, []);

  return {
    isOpen,
    open,
    close,
    toggle,
    capturedSelection,
    consumeCapturedSelection,
  };
}
