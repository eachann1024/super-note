import { useTabs } from "@/stores/useTabs";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";

let suppressNextSidebarSelect = false;
let suppressTimer: number | null = null;

export function isLocalFolderDirectoryPage(pageId: string): boolean {
  const page = usePages.getState().getPage(pageId);
  if (!page?.isFolder) return false;
  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  return notebook?.source === "local-folder";
}

export function openPageFromSidebar(
  pageId: string,
  mode: "preview" | "permanent",
  options?: { pin?: boolean },
) {
  if (isLocalFolderDirectoryPage(pageId)) return;

  const tabs = useTabs.getState();
  if (mode === "permanent") {
    suppressNextSidebarSelect = true;
    if (suppressTimer !== null) window.clearTimeout(suppressTimer);
    suppressTimer = window.setTimeout(() => {
      suppressNextSidebarSelect = false;
      suppressTimer = null;
    }, 400);
    tabs.openPermanentTab(pageId, options);
    return;
  }
  tabs.openPreviewTab(pageId);
}

export function shouldSuppressSidebarSelect(): boolean {
  if (!suppressNextSidebarSelect) return false;
  suppressNextSidebarSelect = false;
  if (suppressTimer !== null) {
    window.clearTimeout(suppressTimer);
    suppressTimer = null;
  }
  return true;
}
