import { useEffect } from "react";
import { WorkspacePage } from "./pages/workspace/WorkspacePage";
import { Toaster } from "@/components/ui/sonner";
import { usePages } from "./stores/usePages";
import { useTabs } from "./stores/useTabs";
import {
  useSettings,
  EDITOR_FONT_SIZE_DEFAULT,
} from "@/stores/useSettings";
import { useAppHotkeys } from "./hooks/useAppHotkeys";
import { usePluginEvents } from "./hooks/usePluginEvents";
import { useNativeContextMenuGuard } from "./hooks/useNativeContextMenuGuard";

const UI_FONT_SIZE_MAP = {
  small: 14,
  normal: 16,
} as const;

function App() {
  const {
    uiFontSize,
    editorFontSize,
    customFonts,
    privacy,
  } = useSettings();
  const { hydrated, onboardingCompleted, activePageId } = usePages();

  // 绑定全局快捷键
  useAppHotkeys();

  // 全局兜底：禁止未被 Radix / A1 处理的原生浏览器右键菜单
  useNativeContextMenuGuard();

  // 订阅插件/本地关联事件
  const { restoreLastNoteIfNeeded, clearActivePageForBlankEntry } = usePluginEvents();

  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__gooseNoteAutoOpenLastNote = privacy.autoOpenLastNote;
  }, [privacy.autoOpenLastNote]);

  // 首次打开应用时创建新手引导页面
  useEffect(() => {
    if (hydrated && !onboardingCompleted) {
      usePages.getState().createOnboardingPages();
    }
  }, [hydrated, onboardingCompleted]);

  // 同步 tab 状态：清理已删除页面的 tab（保留尚未加载的本地文件夹标签）
  useEffect(() => {
    if (!hydrated) return;
    const tabsStore = useTabs.getState();

    // reconcileTabs 会保留属于「尚未加载的本地文件夹笔记本」的标签，
    // 待该文件夹加载后再由 loadLocalFolderPages 末尾的 reconcile 清理。
    tabsStore.reconcileTabs();

    // 仅在没有标签时，用当前页面初始化第一个标签（E2E 测试自行控制标签状态）
    const { activePageId, pages } = usePages.getState();
    if (
      activePageId &&
      useTabs.getState().openTabs.length === 0 &&
      pages[activePageId] &&
      !(typeof window !== "undefined" && (window as Window & { __GOOSE_E2E__?: boolean }).__GOOSE_E2E__)
    ) {
      useTabs.getState().openTab(activePageId);
    }
  }, [hydrated, activePageId]);

  // 根据隐私设置决定是否自动打开上次笔记
  useEffect(() => {
    if (!hydrated) return;

    const { privacy } = useSettings.getState();
    if (!privacy.autoOpenLastNote) {
      clearActivePageForBlankEntry();
      return;
    }

    restoreLastNoteIfNeeded();
  }, [hydrated, restoreLastNoteIfNeeded, clearActivePageForBlankEntry]);

  useEffect(() => {
    if (!hydrated || !privacy.autoCloseInactiveTabs) return;

    const closeExpiredTabs = () => {
      useTabs.getState().closeExpiredTabs();
    };

    closeExpiredTabs();
    const timer = window.setInterval(closeExpiredTabs, 15 * 60 * 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    hydrated,
    privacy.autoCloseInactiveTabs,
    privacy.autoCloseInactiveTabsHours,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const targetSize = UI_FONT_SIZE_MAP[uiFontSize] ?? UI_FONT_SIZE_MAP.small;
    root.style.setProperty("font-size", `${targetSize}px`);
  }, [uiFontSize]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--editor-font-size", `${editorFontSize}px`);
    root.style.setProperty(
      "--editor-scale",
      (editorFontSize / EDITOR_FONT_SIZE_DEFAULT).toFixed(4),
    );
  }, [editorFontSize]);

  useEffect(() => {
    applyFontVariables(customFonts);
  }, [customFonts]);

  return (
    <>
      <WorkspacePage />
      <Toaster />
    </>
  );
}

export default App;
