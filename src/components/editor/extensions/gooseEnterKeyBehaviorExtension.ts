import { createExtension } from "@blocknote/core";

export const gooseEnterKeyBehaviorExtension = createExtension({
  key: "goose-enter-key-behavior",
  keyboardShortcuts: {
    Enter: () => {
      // 1. Check if the active overlay or menus are visible to avoid blocking select
      if (
        document.querySelector(".bn-suggestion-menu") ||
        document.querySelector(".bn-popover") ||
        document.querySelector('[role="dialog"]') ||
        document.querySelector('[role="menu"]')
      ) {
        return false;
      }

      // 2. We need a way to inspect the settings runtime state. Since extensions are created
      // statically, we will read the active value from a global or a custom event/attribute,
      // or we can use a window property set by the host editor, which avoids passing references.
      // Alternatively, we check the global store directly or trigger a custom check.
      // But wait! We can just dispatch the check event, or read from window.gooseEnterKeyBehavior.
      interface GooseWindow extends Window {
        gooseEnterKeyBehavior?: "create-block" | "save-exit";
      }
      const gooseWindow = window as unknown as GooseWindow;
      const behavior = gooseWindow.gooseEnterKeyBehavior;
      if (behavior !== "save-exit") {
        return false;
      }

      // 3. Trigger exit edit event
      window.dispatchEvent(new CustomEvent("goose-note:enter-save-exit"));

      // 4. Blur the current focused element to collapse virtual keyboard on mobile
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && typeof activeEl.blur === "function") {
        activeEl.blur();
      }

      return true;
    },
  },
});
