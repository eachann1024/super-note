import { expect, test } from "playwright/test";
import {
  normalizeCodeStyle,
  resolveCodeTheme,
} from "../../src/stores/settings/types";
import { resolveTheme } from "../../src/hooks/useResolvedTheme";
import { migrateCodeStyleTo2026 } from "../../src/lib/code-style-migration";

test("Dracula 使用独立设置值并按深浅模式映射", () => {
  expect(normalizeCodeStyle("dracula")).toBe("dracula");
  expect(resolveCodeTheme("dracula", true)).toBe("dracula");
  expect(resolveCodeTheme("dracula", false)).toBe("github-light-mod");
});

test("旧版 Nord 设置值仍保持兼容", () => {
  expect(normalizeCodeStyle("nord")).toBe("nord");
  expect(normalizeCodeStyle("nord-light")).toBe("nord-light");
  expect(migrateCodeStyleTo2026("nord")).toBe("nord");
  expect(migrateCodeStyleTo2026("nord-light")).toBe("nord-light");
  expect(resolveCodeTheme("nord", true)).toBe("nord");
  expect(resolveCodeTheme("nord-light", false)).toBe("nord-light");
});

test("跟随系统主题能解析系统明暗状态", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});
