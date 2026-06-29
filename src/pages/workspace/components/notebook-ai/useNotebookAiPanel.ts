/**
 * 面板开关状态持久化（按入口独立）
 */
import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "goose-note-ai-panel-open";

/** 无记录或读失败时视为关闭（默认不打开 AI 面板）。 */
function readStoredOpen(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "true";
  } catch {}
  return false;
}

export function useNotebookAiPanel() {
  const [isOpen, setIsOpen] = useState<boolean>(readStoredOpen);

  const open = useCallback(() => {
    setIsOpen(true);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {}
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "false");
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  return { isOpen, open, close, toggle };
}
