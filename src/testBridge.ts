import { useTabs } from "@/stores/useTabs";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useSettings } from "@/stores/useSettings";
import { activateNotebook } from "@/lib/notebookNavigation";

export function installTestBridge() {
  if (!import.meta.env.DEV) return;
  (window as Window & { __GOOSE_TEST__?: Record<string, unknown> }).__GOOSE_TEST__ =
    {
      getTabsState: () => useTabs.getState(),
      getPagesState: () => usePages.getState(),
      getNotebooksState: () => useNotebooks.getState(),
      createNotebook: (name?: string, icon?: string) =>
        useNotebooks.getState().createNotebook(name, icon),
      activateNotebook: (notebookId: string) => activateNotebook(notebookId),
      setCloseTabShortcut: (shortcut: string) =>
        useSettings.getState().setCloseTabShortcut(shortcut),
      openPreviewTab: (pageId: string) =>
        useTabs.getState().openPreviewTab(pageId),
      openPermanentTab: (pageId: string, pin?: boolean) =>
        useTabs.getState().openPermanentTab(pageId, { pin }),
      togglePinTab: (tabId: string) => useTabs.getState().togglePinTab(tabId),
      setActiveTab: (tabId: string) => useTabs.getState().setActiveTab(tabId),
      createPage: (parentId?: string, workspaceId?: string) =>
        usePages.getState().createPage(parentId, workspaceId),
      resetTabs: () =>
        useTabs.setState({
          openTabs: [],
          activeTabId: null,
          tabHistory: [],
          tabHistoryIndex: -1,
          recentlyClosedPageIds: [],
        }),
    };
}
