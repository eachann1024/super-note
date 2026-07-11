import { expect, test } from "playwright/test";
import { matchShortcut, shortcutHasModifier } from "../../src/lib/shortcut-match";

function keyboardEvent(init: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}) {
  return {
    key: init.key,
    code: init.code ?? "",
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  } as KeyboardEvent;
}

test("close-tab shortcut matching covers mac option-composed keys and win/linux alt keys", () => {
  expect(
    matchShortcut(
      keyboardEvent({ key: "∑", code: "KeyW", altKey: true }),
      "Alt+W",
    ),
  ).toBe(true);

  expect(
    matchShortcut(
      keyboardEvent({ key: "w", code: "KeyW", altKey: true }),
      "Alt+W",
    ),
  ).toBe(true);
});

test("configured ctrl close-tab shortcut matches Chromium keyboard events", () => {
  expect(
    matchShortcut(
      keyboardEvent({ key: "w", code: "KeyW", ctrlKey: true }),
      "Ctrl+W",
    ),
  ).toBe(true);
});

test("shortcutHasModifier distinguishes modified shortcuts from text keys", () => {
  expect(shortcutHasModifier("Ctrl+W")).toBe(true);
  expect(shortcutHasModifier("Alt+W")).toBe(true);
  expect(shortcutHasModifier("W")).toBe(false);
});

test("modifier-only legacy shortcuts never intercept a bare modifier key", () => {
  expect(
    matchShortcut(
      keyboardEvent({ key: "Meta", code: "MetaLeft", metaKey: true }),
      "Meta",
    ),
  ).toBe(false);
  expect(
    matchShortcut(
      keyboardEvent({ key: "Control", code: "ControlLeft", ctrlKey: true }),
      "Ctrl",
    ),
  ).toBe(false);
});

test("recorded plus shortcuts can be matched", () => {
  expect(
    matchShortcut(
      keyboardEvent({ key: "+", code: "Equal", shiftKey: true }),
      "Shift+Plus",
    ),
  ).toBe(true);
});
