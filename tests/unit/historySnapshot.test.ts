import { expect, test } from "playwright/test";
import { recordHistorySnapshot } from "../../src/lib/history/snapshot";
import { resolveHistoryBackend } from "../../src/lib/history/backend";
import { usePages } from "../../src/stores/usePages";

const pageId = "history-page";
const workspaceId = "history-workspace";

function installLocalStorageDb() {
  const storage = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  };
}

test.beforeEach(() => {
  installLocalStorageDb();
  usePages.setState({
    pages: {
      [pageId]: {
        id: pageId,
        workspaceId,
        isFolder: false,
        isLocked: false,
        isFullWidth: false,
        fontSize: "default",
        fontFamily: "default",
        content: [{ type: "paragraph", content: "foo" }],
        createdAt: 0,
        updatedAt: 0,
      },
    },
  });
});

test.afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("idle history records same-length content changes", async () => {
  const first = await recordHistorySnapshot({
    pageId,
    workspaceId,
    content: [{ type: "paragraph", content: "foo" }],
    trigger: "idle",
  });
  const second = await recordHistorySnapshot({
    pageId,
    workspaceId,
    content: [{ type: "paragraph", content: "bar" }],
    trigger: "idle",
  });

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();

  const index = await resolveHistoryBackend(pageId).loadIndex(pageId);
  expect(index.versions).toHaveLength(2);
});
