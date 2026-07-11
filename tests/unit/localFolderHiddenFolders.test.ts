import { expect, test } from "playwright/test";
import {
  shouldIgnoreEntry,
  shouldIgnoreLocalRelativePath,
} from "../../src/lib/local-folder-scanner";

test.describe("local-folder-scanner shouldIgnoreEntry", () => {
  test("ignores dot folders", () => {
    const hidden = new Set<string>();
    expect(shouldIgnoreEntry(".git", hidden)).toBe(true);
    expect(shouldIgnoreEntry(".obsidian", hidden)).toBe(true);
  });

  test("ignores built-in ignored folders", () => {
    const hidden = new Set<string>();
    expect(shouldIgnoreEntry("node_modules", hidden)).toBe(true);
    expect(shouldIgnoreEntry("dist", hidden)).toBe(true);
  });

  test("ignores user-configured hidden folders", () => {
    const hidden = new Set(["assets", "obsidian"]);
    expect(shouldIgnoreEntry("assets", hidden)).toBe(true);
    expect(shouldIgnoreEntry("obsidian", hidden)).toBe(true);
  });

  test("keeps non-hidden folders", () => {
    const hidden = new Set(["assets"]);
    expect(shouldIgnoreEntry("visible", hidden)).toBe(false);
    expect(shouldIgnoreEntry("notes", hidden)).toBe(false);
  });
});

test.describe("local-folder 增量路径过滤", () => {
  test("用户隐藏目录内的新文件不会进入增量加载", () => {
    expect(shouldIgnoreLocalRelativePath("assets/new.md", ["assets"])).toBe(true);
    expect(shouldIgnoreLocalRelativePath("docs/obsidian/new.md", ["obsidian"])).toBe(true);
  });

  test("dot 与内置忽略目录的子文件保持和全量扫描一致", () => {
    expect(shouldIgnoreLocalRelativePath(".goose/history/a.md", [])).toBe(true);
    expect(shouldIgnoreLocalRelativePath(".private.md", [])).toBe(true);
    expect(shouldIgnoreLocalRelativePath("node_modules/pkg/readme.md", [])).toBe(true);
  });

  test("根目录和普通子目录 markdown 文件正常进入增量加载", () => {
    expect(shouldIgnoreLocalRelativePath("note.md", ["assets"])).toBe(false);
    expect(shouldIgnoreLocalRelativePath("docs/note.md", ["assets"])).toBe(false);
  });
});
