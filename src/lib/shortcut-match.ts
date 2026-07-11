import { isMacPlatform } from "@/lib/utils";

function normalizeShortcutToken(raw: string) {
  const token = raw.trim().toLowerCase();
  if (!token) return "";
  if (
    token === "mod" ||
    token === "cmdorctrl" ||
    token === "cmdorcontrol" ||
    token === "commandorcontrol"
  ) {
    return isMacPlatform() ? "meta" : "ctrl";
  }
  if (token === "control" || token === "ctrl") return "ctrl";
  if (token === "meta" || token === "command" || token === "cmd") return "meta";
  if (token === "alt" || token === "option") return "alt";
  if (token === "shift") return "shift";
  if (token === "escape" || token === "esc") return "escape";
  if (token === "+" || token === "plus") return "plus";
  if (token.length === 1) return token;
  return token;
}

function isModifierToken(token: string) {
  return token === "ctrl" || token === "meta" || token === "alt" || token === "shift";
}

export function shortcutHasModifier(shortcut: string) {
  return shortcut
    .split("+")
    .map(normalizeShortcutToken)
    .some(isModifierToken);
}

export function matchShortcut(event: KeyboardEvent, shortcut: string) {
  const trimmed = shortcut.trim();
  if (!trimmed) return false;

  const parts = trimmed
    .split("+")
    .map(normalizeShortcutToken)
    .filter(Boolean);
  if (parts.length === 0) return false;

  const expectedModifiers = {
    ctrl: parts.includes("ctrl"),
    meta: parts.includes("meta"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
  };

  if (
    event.ctrlKey !== expectedModifiers.ctrl ||
    event.metaKey !== expectedModifiers.meta ||
    event.altKey !== expectedModifiers.alt ||
    event.shiftKey !== expectedModifiers.shift
  ) {
    return false;
  }

  const keyToken = parts.find((part) => !isModifierToken(part));
  const eventKey = normalizeShortcutToken(event.key);
  // 旧版本可能持久化了 modifier-only 配置；它们不应劫持单独的修饰键。
  if (!keyToken) return false;
  if (!isModifierToken(eventKey) && eventKey === keyToken) return true;
  // macOS 上 Option 组合键的 event.key 是变音字符（如 ⌥W → "∑"），用 event.code 兜底
  const code = event.code || "";
  let codeKey = "";
  if (/^Key[A-Z]$/.test(code)) codeKey = code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(code)) codeKey = code.slice(5);
  return !!codeKey && codeKey === keyToken;
}
