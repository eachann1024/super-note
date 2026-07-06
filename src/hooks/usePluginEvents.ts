import { useEffect } from "react";
import {
  activateNotebook,
  resolveNotebookLandingPageId,
} from "@/lib/notebookNavigation";
import { UToolsAdapter } from "@/lib/utools";
import { useSettings } from "@/stores/useSettings";
import { DEFAULT_NOTEBOOK, useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { useTabs } from "@/stores/useTabs";
import { fs } from "@/lib/utools/fs";

type UToolsPluginEnterDetail = {
  code?: string;
  type?: string;
  payload?: unknown;
  optional?: boolean;
};

const applyUToolsWindowHeight = () => {
  const state = useSettings.getState();
  if (state.utools.windowHeight) {
    UToolsAdapter.setExpendHeight(state.utools.windowHeight);
  }
};

const restoreLastNoteIfNeeded = () => {
  const pagesStore = usePages.getState();
  if (pagesStore.activePageId) return;

  const targetPageId = resolveNotebookLandingPageId(
    useNotebooks.getState().activeNotebookId,
  );
  if (!targetPageId) return;

  useTabs.getState().openTab(targetPageId);
};

const clearActivePageForBlankEntry = () => {
  useTabs.setState({ activeTabId: null });
  const pagesStore = usePages.getState();
  if (!pagesStore.activePageId) return;

  void pagesStore.setActivePage(null);
};

export function usePluginEvents() {
  // 仅首次挂载时应用一次窗口高度
  useEffect(() => {
    applyUToolsWindowHeight();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePluginEnter = (event: Event) => {
      const customEvent = event as CustomEvent<UToolsPluginEnterDetail>;
      const { code } = customEvent.detail || {};

      applyUToolsWindowHeight();

      if (!usePages.getState().hydrated) return;
      if (!useSettings.getState().privacy.autoOpenLastNote) return;
      if (code === "open_folder" || code === "new_page") return;

      restoreLastNoteIfNeeded();
    };

    const handlePluginOut = () => {
      if (!useSettings.getState().privacy.autoOpenLastNote) {
        clearActivePageForBlankEntry();
      }
    };

    // new_page 唤起：用选中文字新建笔记并打开（不触碰任何已存在页面）。
    const handleNewPage = async (event: Event) => {
      if (!usePages.getState().hydrated) return;
      const customEvent = event as CustomEvent<{ text?: string }>;
      const text = customEvent.detail?.text ?? "";

      const pagesStore = usePages.getState();
      const nbId =
        useNotebooks.getState().activeNotebookId ?? DEFAULT_NOTEBOOK;

      let newId: string;
      let content = null;
      if (typeof text === "string" && text.trim().length > 0) {
        const { importMarkdownFragment } = await import("@/lib/export");
        content = importMarkdownFragment(text);
      }
      if (content) {
        newId = pagesStore.createPageRecord({ workspaceId: nbId, content });
      } else {
        // 解析失败或无选中文字：回退到空白新页，绝不复用/覆盖已存在页面。
        newId = pagesStore.createPage(undefined, nbId);
      }
      // openTab 内部会 scheduleSetActivePage → setActivePage（含 setLastActivePage），
      // 无需再显式调用，避免重复/竞态。
      useTabs.getState().openTab(newId);
    };

    // 速记小窗改动了某条笔记：从 db 重读该页，使主窗内存与 db 一致（防跨窗脏写）。
    // 跳过主窗正在编辑的活动页（避免打断输入）；reloadPageFromStorage 内部也只在
    // db 版本更新时才覆盖，双重保险。
    const handleExternalNoteUpdated = (event: Event) => {
      if (!usePages.getState().hydrated) return;
      const customEvent = event as CustomEvent<{ pageId?: string }>;
      const pageId = customEvent.detail?.pageId;
      if (typeof pageId !== "string" || pageId.length === 0) return;
      const isActiveAndFocused =
        usePages.getState().activePageId === pageId && document.hasFocus();
      if (isActiveAndFocused) return;
      usePages.getState().reloadPageFromStorage(pageId);
    };

    // onMainPush select 的真正落地通路（goose-note:navigate 全仓无人监听，不可用）。
    const handleOpenNote = (event: Event) => {
      if (!usePages.getState().hydrated) return;
      const customEvent = event as CustomEvent<{ pageId?: string }>;
      const pageId = customEvent.detail?.pageId;
      if (typeof pageId !== "string" || pageId.length === 0) return;
      if (!usePages.getState().pages[pageId]) return;
      useTabs.getState().openTab(pageId);
    };

    window.addEventListener(
      "goose-note:plugin-enter",
      handlePluginEnter as EventListener,
    );
    window.addEventListener(
      "goose-note:plugin-out",
      handlePluginOut as EventListener,
    );
    window.addEventListener(
      "goose-note:new-page",
      handleNewPage as EventListener,
    );
    window.addEventListener(
      "goose-note:open-note",
      handleOpenNote as EventListener,
    );
    window.addEventListener(
      "goose-note:note-updated-external",
      handleExternalNoteUpdated as EventListener,
    );

    return () => {
      window.removeEventListener(
        "goose-note:plugin-enter",
        handlePluginEnter as EventListener,
      );
      window.removeEventListener(
        "goose-note:plugin-out",
        handlePluginOut as EventListener,
      );
      window.removeEventListener(
        "goose-note:new-page",
        handleNewPage as EventListener,
      );
      window.removeEventListener(
        "goose-note:open-note",
        handleOpenNote as EventListener,
      );
      window.removeEventListener(
        "goose-note:note-updated-external",
        handleExternalNoteUpdated as EventListener,
      );
    };
  }, []);

  // 打开外部文件夹关联监听
  useEffect(() => {
    const openFolder = async (folderPath: string) => {
      const folderName = folderPath.split(/[\\/]/).pop() || "Unknown";
      const notebookId = useNotebooks
        .getState()
        .createLocalFolderNotebook(folderName, folderPath);
      await usePages
        .getState()
        .loadLocalFolderPages(notebookId, folderPath, { showWelcome: true });
    };

    const handleOpenFolder = (event: Event & { detail?: { path: string } }) => {
      const customEvent = event as Event & { detail?: { path: string } };
      const { path: folderPath } = customEvent.detail || {};
      if (typeof folderPath === "string" && folderPath.length > 0) {
        void openFolder(folderPath);
      }
    };

    window.addEventListener(
      "goose-note:open-folder",
      handleOpenFolder as EventListener,
    );

    const pending = (window as { __gooseNotePendingOpenFolder?: string })
      .__gooseNotePendingOpenFolder;
    if (typeof pending === "string" && pending.length > 0) {
      (
        window as Window & { __gooseNotePendingOpenFolder?: string | null }
      ).__gooseNotePendingOpenFolder = null;
      void openFolder(pending);
    }

    return () => {
      window.removeEventListener(
        "goose-note:open-folder",
        handleOpenFolder as EventListener,
      );
    };
  }, []);

  // 监控本地文件夹的变更和存活状态
  useEffect(() => {
    if (!fs.isAvailable()) return;
    const notebooksStore = useNotebooks.getState();
    const pagesStore = usePages.getState();
    const notebooks = Object.values(notebooksStore.notebooks).sort(
      (a, b) => a.createdAt - b.createdAt,
    );

    const localNotebooks = notebooks.filter(
      (notebook) => notebook.source === "local-folder",
    );

    void (async () => {
      for (const notebook of localNotebooks) {
        const localPath = notebook.localPath;
        const exists =
          typeof localPath === "string" &&
          localPath.length > 0 &&
          (await fs.existsAsync(localPath));

        if (exists) {
          if (notebook.localPathMissing) {
            notebooksStore.updateNotebook(notebook.id, {
              localPathMissing: false,
            });
          }
          await pagesStore.loadLocalFolderPages(notebook.id, localPath!);
        } else {
          if (!notebook.localPathMissing) {
            notebooksStore.updateNotebook(notebook.id, {
              localPathMissing: true,
            });
          }
          pagesStore.removePagesByWorkspaceId(notebook.id);
        }
      }

      const activeNotebookId = notebooksStore.activeNotebookId;
      const activeNotebook = activeNotebookId
        ? notebooksStore.notebooks[activeNotebookId]
        : null;
      const activeInvalid =
        activeNotebook?.source === "local-folder" &&
        activeNotebook.localPathMissing;

      if (activeInvalid) {
        const nextNotebook =
          notebooks.find((notebook) => !notebook.localPathMissing) ||
          notebooks[0];
        if (nextNotebook && nextNotebook.id !== activeNotebookId) {
          await activateNotebook(nextNotebook.id);
        }
      }
    })();
  }, []);

  return {
    restoreLastNoteIfNeeded,
    clearActivePageForBlankEntry,
  };
}
