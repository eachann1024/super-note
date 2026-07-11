import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSettings, EDITOR_FONT_SIZE_DEFAULT } from "@/stores/useSettings";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useTabs } from "@/stores/useTabs";
import { useSidebarView } from "@/stores/useSidebarView";
import { closeAllOverlays } from "@/lib/closeAllOverlays";
import { matchShortcut, shortcutHasModifier } from "@/lib/shortcut-match";

type HotkeyEntry = {
  id: string;
  match: (event: KeyboardEvent) => boolean;
  when?: (event: KeyboardEvent) => boolean;
  handler: (event: KeyboardEvent) => void;
};

export function useAppHotkeys() {
  // Subscribe to closeTabShortcut so the ref stays in sync, but the keydown
  // listener itself is registered only once (deps=[]).
  const { closeTabShortcut, appShortcuts } = useSettings();
  const { openTabs, activeTabId } = useTabs();

  // Dynamic values consumed inside the single keydown listener must be read
  // through refs, otherwise the once-registered listener would capture stale
  // values (breaks tab switching / close after the list changes).
  const closeTabShortcutRef = useRef(closeTabShortcut);
  const appShortcutsRef = useRef(appShortcuts);
  const openTabsRef = useRef(openTabs);
  const activeTabIdRef = useRef(activeTabId);

  useEffect(() => {
    closeTabShortcutRef.current = closeTabShortcut;
  }, [closeTabShortcut]);
  useEffect(() => {
    appShortcutsRef.current = appShortcuts;
  }, [appShortcuts]);
  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    const isEditableInput = () => {
      const target = document.activeElement;
      return (
        target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      );
    };
    const isRichTextEditing = () => {
      const target = document.activeElement;
      return (
        target instanceof HTMLElement &&
        (target.isContentEditable || !!target.closest(".bn-editor"))
      );
    };

    // ----- font zoom: keep event.code fallback (small keypad / non-US layouts) -----
    const isZoomInKey = (event: KeyboardEvent) =>
      event.key === "+" ||
      event.key === "=" ||
      event.code === "Equal" ||
      event.code === "NumpadAdd";
    const isZoomOutKey = (event: KeyboardEvent) =>
      event.key === "-" ||
      event.code === "Minus" ||
      event.code === "NumpadSubtract";
    const isZoomResetKey = (event: KeyboardEvent) =>
      event.key === "0" || event.code === "Digit0" || event.code === "Numpad0";

    // ----- shared modifier gate for meta/ctrl-based shortcuts -----
    const hasPrimaryModifier = (event: KeyboardEvent) =>
      (event.metaKey || event.ctrlKey) && !event.altKey && !event.repeat;

    const matchesConfiguredShortcut = (event: KeyboardEvent, shortcut: string) =>
      matchShortcut(
        event.key === " "
          ? ({
              key: "Space",
              code: event.code,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              altKey: event.altKey,
              shiftKey: event.shiftKey,
            } as KeyboardEvent)
          : event,
        shortcut,
      );

    const entries: HotkeyEntry[] = [
      // F3 → editor find navigation
      {
        id: "find-nav-f3",
        match: (event) => event.key === "F3",
        handler: (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("goose-note:editor-find-nav", {
              detail: { direction: event.shiftKey ? -1 : 1 },
            }),
          );
        },
      },
      // cmd+, settings — if still default, keep Chinese comma / event.code fallback
      {
        id: "open-settings",
        match: (event) => {
          const s = appShortcutsRef.current.openSettings;
          if (!s) return false;
          if (s === "Mod+,") {
            return (
              hasPrimaryModifier(event) &&
              (event.key === "," ||
                event.key === "，" ||
                event.code === "Comma") &&
              !event.shiftKey
            );
          }
          return matchesConfiguredShortcut(event, s);
        },
        handler: (event) => {
          event.preventDefault();
          closeAllOverlays();
          window.dispatchEvent(new CustomEvent("goose-note:open-settings"));
        },
      },
      // cmd+shift+k search
      {
        id: "open-search",
        match: (event) => {
          const s = appShortcutsRef.current.openSearch;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        when: () => !isEditableInput() && !isRichTextEditing(),
        handler: (event) => {
          event.preventDefault();
          closeAllOverlays();
          window.dispatchEvent(new CustomEvent("goose-note:open-search"));
        },
      },
      // Mod+J 开关 AI 面板 —— 对齐 Notion（mac ⌘J / win ctrl J），跨平台用 Mod 自动转
      // 是否真正切换由 WorkspaceLayout 侧监听判断（需 ai.enabled），这里只负责派发
      {
        id: "toggle-ai-panel",
        match: (event) => {
          const s = appShortcutsRef.current.toggleAIPanel;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        handler: (event) => {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("goose-note:toggle-ai-panel"));
        },
      },
      // toggle sidebar — configurable, default Alt+B; allow triggering even from editor
      {
        id: "toggle-sidebar",
        match: (event) => {
          const s = appShortcutsRef.current.toggleSidebar;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        handler: (event) => {
          event.preventDefault();
          event.stopPropagation();
          useSidebarView.getState().toggleSidebarCollapsed();
        },
      },
      // cmd+f editor find open
      {
        id: "editor-find-open",
        match: (event) => {
          const s = appShortcutsRef.current.editorFindOpen;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        handler: (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(new CustomEvent("goose-note:editor-find-open"));
        },
      },
      // cmd+g forward / cmd+shift+g backward — direction driven by shiftKey,
      // so we cannot use matchShortcut('Mod+G') (it would reject cmd+shift+g).
      {
        id: "editor-find-nav-g",
        match: (event) =>
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          event.key.toLowerCase() === "g",
        handler: (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("goose-note:editor-find-nav", {
              detail: { direction: event.shiftKey ? -1 : 1 },
            }),
          );
        },
      },
      // font zoom in (cmd +/=) — custom matcher keeps event.code fallback
      {
        id: "zoom-in",
        match: (event) => hasPrimaryModifier(event) && isZoomInKey(event),
        handler: (event) => {
          event.preventDefault();
          useSettings.getState().increaseEditorFontSize();
        },
      },
      // font zoom out (cmd -)
      {
        id: "zoom-out",
        match: (event) => hasPrimaryModifier(event) && isZoomOutKey(event),
        handler: (event) => {
          event.preventDefault();
          useSettings.getState().decreaseEditorFontSize();
        },
      },
      // font zoom reset (cmd 0)
      {
        id: "zoom-reset",
        match: (event) => hasPrimaryModifier(event) && isZoomResetKey(event),
        handler: (event) => {
          event.preventDefault();
          useSettings.getState().setEditorFontSize(EDITOR_FONT_SIZE_DEFAULT);
        },
      },
      // cmd+s save
      {
        id: "save",
        match: (event) => {
          const s = appShortcutsRef.current.saveNote;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        when: () => !isEditableInput(),
        handler: (event) => {
          event.preventDefault();
          void (async () => {
            window.dispatchEvent(
              new CustomEvent("goose-note:flush-editor", {
                detail: { immediate: true },
              }),
            );
            await usePages.getState().flushPendingLocalSaves();
            toast("内容已保存", { duration: 1500 });
          })();
        },
      },
      // cmd+n new note
      {
        id: "new-note",
        match: (event) => {
          const s = appShortcutsRef.current.newNote;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        when: () => !isEditableInput(),
        handler: (event) => {
          event.preventDefault();
          void (async () => {
            const pagesStore = usePages.getState();
            const notebooksStore = useNotebooks.getState();
            const { activeNotebookId, notebooks } = notebooksStore;
            if (!activeNotebookId) return;

            const notebook = notebooks[activeNotebookId];
            const newPageId =
              notebook?.source === "local-folder"
                ? await pagesStore.createLocalPage(undefined, activeNotebookId)
                : pagesStore.createPage(undefined, activeNotebookId);
            if (!newPageId) return;
            useTabs.getState().openTab(newPageId);
            toast(
              notebook?.source === "local-folder"
                ? "已创建新文件"
                : "已创建新笔记",
              { duration: 1500 },
            );
          })();
        },
      },
      // toggle theme (Mod+Shift+L)
      {
        id: "toggle-theme",
        match: (event) => {
          const s = appShortcutsRef.current.toggleTheme;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        handler: (event) => {
          event.preventDefault();
          useSettings.getState().toggleDarkMode();
        },
      },
      // nav-back / nav-forward (Mod+[ / Mod+])
      {
        id: "nav-back",
        match: (event) => {
          const s = appShortcutsRef.current.navBack;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        when: () => {
          const hasOpenModal = () =>
            !!document.querySelector(
              '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
            );
          return !hasOpenModal();
        },
        handler: (event) => {
          event.preventDefault();
          useTabs.getState().goBackTabHistory();
        },
      },
      {
        id: "nav-forward",
        match: (event) => {
          const s = appShortcutsRef.current.navForward;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        when: () => {
          const hasOpenModal = () =>
            !!document.querySelector(
              '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
            );
          return !hasOpenModal();
        },
        handler: (event) => {
          event.preventDefault();
          useTabs.getState().goForwardTabHistory();
        },
      },
      // new-tab (Mod+T)
      {
        id: "new-tab",
        match: (event) => {
          const s = appShortcutsRef.current.newTab;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        when: () => {
          const hasOpenModal = () =>
            !!document.querySelector(
              '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
            );
          return !hasOpenModal();
        },
        handler: (event) => {
          event.preventDefault();
          useTabs.getState().openWelcomeTab();
        },
      },
      // unified close (user-configurable shortcut, read from ref)
      // Layered: toast → dialog → tab. Fires even inside inputs unless in shortcut recorder.
      {
        id: "unified-close",
        match: (event) =>
          !event.defaultPrevented &&
          matchesConfiguredShortcut(event, closeTabShortcutRef.current),
        when: (event) => {
          const target = event.target as HTMLElement | null;
          // Never intercept when inside the shortcut recorder input itself
          if (target?.closest?.("[data-shortcut-recorder]")) return false;
          // Check if any closeable layer exists — if so, fire even from an input
          const hasToast = !!document.querySelector(
            '[data-sonner-toast]:not([data-removed="true"])',
          );
          const hasDialog = !!document.querySelector(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          );
          if (hasToast || hasDialog) return true;
          // Modified close shortcuts should work from the editor too; bare keys
          // stay blocked so normal typing cannot close a tab by accident.
          const isInEditableTarget =
            !!target &&
            (target.tagName === "INPUT" ||
              target.tagName === "SELECT" ||
              target.tagName === "TEXTAREA" ||
              target.isContentEditable ||
              !!target.closest?.(".bn-editor"));
          return !isInEditableTarget || shortcutHasModifier(closeTabShortcutRef.current);
        },
        handler: (event) => {
          event.preventDefault();
          // a. dismiss toasts first
          const toastEl = document.querySelector(
            '[data-sonner-toast]:not([data-removed="true"])',
          );
          if (toastEl) {
            toast.dismiss();
            return;
          }
          // b. close topmost dialog via Escape
          const dialogEl = document.querySelector(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          );
          if (dialogEl) {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                code: "Escape",
                bubbles: true,
                cancelable: true,
              }),
            );
            return;
          }
          // c. close tab
          const activeId = activeTabIdRef.current;
          if (activeId) {
            useTabs.getState().closeTab(activeId);
            return;
          }
          void usePages.getState().setActivePage(null);
        },
      },
      // Cmd/Ctrl+1~8 跳到对应序号标签，Cmd/Ctrl+9 跳到最后一个标签（对齐 VSCode/浏览器）。
      // 不绑定 Cmd+0（已被字体缩放重置占用）。使用 event.code 兼容非美式键盘布局。
      {
        id: "switch-tab-by-number",
        match: (event) => {
          if (event.defaultPrevented) return false;
          if (
            !(event.metaKey || event.ctrlKey) ||
            event.altKey ||
            event.shiftKey
          ) {
            return false;
          }
          return /^Digit[1-9]$/.test(event.code);
        },
        handler: (event) => {
          const code = event.code;
          const digit = Number(code.slice(-1)); // 1~9
          const tabs = openTabsRef.current;
          // Cmd+9 → 最后一个标签；Cmd+1~8 → 对应序号（0-based index）
          const targetTab =
            digit === 9 ? tabs[tabs.length - 1] : tabs[digit - 1];
          if (!targetTab) return;
          event.preventDefault();
          useTabs.getState().setActiveTab(targetTab.id);
        },
      },
      // Ctrl+Tab / Ctrl+Shift+Tab cycle tabs
      {
        id: "cycle-tab",
        match: (event) =>
          event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          event.key === "Tab",
        handler: (event) => {
          const tabs = openTabsRef.current;
          if (tabs.length < 2) return;
          event.preventDefault();
          const currentIndex = tabs.findIndex(
            (tab) => tab.id === activeTabIdRef.current,
          );
          const direction = event.shiftKey ? -1 : 1;
          const nextIndex =
            (currentIndex + direction + tabs.length) % tabs.length;
          useTabs.getState().setActiveTab(tabs[nextIndex].id);
        },
      },
      // Mod+Shift+T reopen last closed tab
      {
        id: "reopen-tab",
        match: (event) => {
          if (event.defaultPrevented) return false;
          const s = appShortcutsRef.current.reopenTab;
          return !!s && matchesConfiguredShortcut(event, s);
        },
        handler: (event) => {
          event.preventDefault();
          useTabs.getState().reopenLastClosedTab();
        },
      },
    ];

    const dispatcher = (event: KeyboardEvent) => {
      // 快捷键录制输入框内的按键一律放行，否则已配置的快捷键会在
      // capture 阶段被吞掉，导致用户无法重新录制同名/相近的快捷键
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-shortcut-recorder]")) return;
      for (const entry of entries) {
        if (!entry.match(event)) continue;
        if (entry.when && !entry.when(event)) continue;
        entry.handler(event);
        return;
      }
    };

    document.addEventListener("keydown", dispatcher, true);
    return () => {
      document.removeEventListener("keydown", dispatcher, true);
    };
  }, []);

  // Mouse side buttons (back/forward) — non-keyboard, kept as a separate
  // once-registered effect (uses store getState, no dynamic deps).
  useEffect(() => {
    let lastHandledButton = -1;
    let lastHandledAt = 0;

    const handleMouseSideButton = (event: MouseEvent) => {
      const isBack = event.button === 3;
      const isForward = event.button === 4;
      if (!isBack && !isForward) return;

      const now = Date.now();
      if (event.button === lastHandledButton && now - lastHandledAt < 120) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      lastHandledButton = event.button;
      lastHandledAt = now;
      event.preventDefault();
      event.stopPropagation();

      if (isBack) {
        useTabs.getState().goBackTabHistory();
        return;
      }

      useTabs.getState().goForwardTabHistory();
    };

    window.addEventListener("mousedown", handleMouseSideButton, true);
    window.addEventListener("mouseup", handleMouseSideButton, true);
    window.addEventListener("auxclick", handleMouseSideButton, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseSideButton, true);
      window.removeEventListener("mouseup", handleMouseSideButton, true);
      window.removeEventListener("auxclick", handleMouseSideButton, true);
    };
  }, []);
}
