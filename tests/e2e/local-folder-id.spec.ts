import { expect, test, type Page } from "playwright/test";

type LocalPageInfo = {
  id: string;
  workspaceId: string;
  isFolder?: boolean;
  localFilePath?: string;
  content?: unknown;
};

type PagesState = {
  pages: Record<string, LocalPageInfo>;
  activePageId: string | null;
  createLocalPage: (
    parentId?: string,
    workspaceId?: string,
  ) => Promise<string | null>;
  renameLocalPageFile: (pageId: string, newBaseName: string) => Promise<string>;
  saveLocalPageContent: (pageId: string, content: unknown) => Promise<boolean>;
};

type TabsState = {
  openTabs: Array<{ pageId: string; preview?: boolean; pinned?: boolean }>;
  activeTabId: string | null;
};

type LocalHarness = {
  setupMockNotebook: () => Promise<{ notebookId: string }>;
  readMockFile: (path: string) => string | null;
  stores: {
    usePages: {
      getState: () => PagesState;
      setState: (
        partial:
          | Partial<PagesState>
          | ((state: PagesState) => Partial<PagesState>),
      ) => void;
    };
    useTabs: {
      getState: () => TabsState;
      setState: (partial: Partial<TabsState>) => void;
    };
  };
};

type LocalHarnessWindow = Window & {
  __GOOSE_E2E__?: boolean;
  __gooseTest?: LocalHarness;
};

async function waitForLocalHarness(page: Page) {
  await page.waitForFunction(() => {
    const harness = (window as LocalHarnessWindow).__gooseTest;
    return Boolean(harness?.stores?.usePages);
  });
}

test.describe("local folder stable page ids", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as LocalHarnessWindow).__GOOSE_E2E__ = true;
      window.localStorage.setItem(
        "goose-note-settings",
        JSON.stringify({ state: { hideExpandArrows: true }, version: 0 }),
      );
    });
    await page.goto("/?e2eLocalMock");
    await waitForLocalHarness(page);
  });

  test("clicking a local folder row toggles it without opening an editor tab", async ({
    page,
  }) => {
    const { folderId, nestedFileId } = await page.evaluate(async () => {
      const harness = (window as LocalHarnessWindow).__gooseTest;
      if (!harness) throw new Error("Local folder harness unavailable");

      const { notebookId } = await harness.setupMockNotebook();
      harness.stores.useTabs.setState({ openTabs: [], activeTabId: null });
      harness.stores.usePages.setState({ activePageId: null });

      const pages = harness.stores.usePages.getState().pages;
      const folder = Object.values(pages).find(
        (page) =>
          page.workspaceId === notebookId &&
          page.isFolder &&
          page.localFilePath === "/mock-notes/sub",
      );
      const nestedFile = Object.values(pages).find(
        (page) =>
          page.workspaceId === notebookId &&
          !page.isFolder &&
          page.localFilePath === "/mock-notes/sub/nested.md",
      );
      if (!folder || !nestedFile) {
        throw new Error("Expected mock folder fixture not found");
      }

      return { folderId: folder.id, nestedFileId: nestedFile.id };
    });

    const folderRow = page.locator(`[data-rct-item-id="${folderId}"]`).first();
    const nestedFileRow = page.locator(`[data-rct-item-id="${nestedFileId}"]`);

    await expect(folderRow).toBeVisible({ timeout: 15_000 });
    await expect(nestedFileRow).toBeHidden();

    await folderRow.click({ position: { x: 100, y: 14 } });
    await expect(nestedFileRow).toBeVisible();

    const afterExpand = await page.evaluate(() => {
      const harness = (window as LocalHarnessWindow).__gooseTest;
      if (!harness) throw new Error("Local folder harness unavailable");
      const tabs = harness.stores.useTabs.getState();
      const pages = harness.stores.usePages.getState();
      return {
        openTabs: tabs.openTabs,
        activeTabId: tabs.activeTabId,
        activePageId: pages.activePageId,
      };
    });
    expect(afterExpand.openTabs).toHaveLength(0);
    expect(afterExpand.activeTabId).toBeNull();
    expect(afterExpand.activePageId).toBeNull();

    await folderRow.click({ position: { x: 100, y: 14 } });
    await expect(nestedFileRow).toBeHidden();

    const afterCollapse = await page.evaluate(() => {
      const harness = (window as LocalHarnessWindow).__gooseTest;
      if (!harness) throw new Error("Local folder harness unavailable");
      const tabs = harness.stores.useTabs.getState();
      const pages = harness.stores.usePages.getState();
      return {
        openTabs: tabs.openTabs,
        activeTabId: tabs.activeTabId,
        activePageId: pages.activePageId,
      };
    });
    expect(afterCollapse.openTabs).toHaveLength(0);
    expect(afterCollapse.activeTabId).toBeNull();
    expect(afterCollapse.activePageId).toBeNull();
  });

  test("recreating 新页面 after renaming it keeps both files in the page list", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const harness = (window as LocalHarnessWindow).__gooseTest;
      if (!harness) throw new Error("Local folder harness unavailable");

      const { notebookId } = await harness.setupMockNotebook();
      const pagesStore = harness.stores.usePages.getState();

      const firstId = await pagesStore.createLocalPage(undefined, notebookId);
      if (!firstId) throw new Error("Failed to create first local page");

      await pagesStore.renameLocalPageFile(firstId, "Renamed Page");

      const secondId = await pagesStore.createLocalPage(undefined, notebookId);
      if (!secondId) throw new Error("Failed to create second local page");

      const state = harness.stores.usePages.getState();
      const localPages = Object.values(state.pages)
        .filter((page) => page.workspaceId === notebookId && !page.isFolder)
        .map((page) => ({
          id: page.id,
          localFilePath: page.localFilePath,
        }));

      return {
        firstId,
        secondId,
        firstPath: state.pages[firstId]?.localFilePath,
        secondPath: state.pages[secondId]?.localFilePath,
        localPages,
        renamedFile: harness.readMockFile("/mock-notes/Renamed Page.md"),
        newFile: harness.readMockFile("/mock-notes/新页面.md"),
      };
    });

    expect(result.secondId).not.toBe(result.firstId);
    expect(result.firstPath).toBe("/mock-notes/Renamed Page.md");
    expect(result.secondPath).toBe("/mock-notes/新页面.md");
    expect(result.renamedFile).not.toBeNull();
    expect(result.newFile).not.toBeNull();
    expect(result.localPages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: result.firstId,
          localFilePath: "/mock-notes/Renamed Page.md",
        }),
        expect.objectContaining({
          id: result.secondId,
          localFilePath: "/mock-notes/新页面.md",
        }),
      ]),
    );
  });

  test("saving is rejected when two pages point at the same local file", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const harness = (window as LocalHarnessWindow).__gooseTest;
      if (!harness) throw new Error("Local folder harness unavailable");

      const { notebookId } = await harness.setupMockNotebook();
      const pagesStore = harness.stores.usePages.getState();

      const firstId = await pagesStore.createLocalPage(undefined, notebookId);
      if (!firstId) throw new Error("Failed to create first local page");
      await pagesStore.renameLocalPageFile(firstId, "Collision Target");

      const secondId = await pagesStore.createLocalPage(undefined, notebookId);
      if (!secondId) throw new Error("Failed to create second local page");

      const targetPath = "/mock-notes/Collision Target.md";
      const before = harness.readMockFile(targetPath);

      harness.stores.usePages.setState((state) => ({
        pages: {
          ...state.pages,
          [secondId]: {
            ...state.pages[secondId],
            localFilePath: targetPath,
          },
        },
      }));

      const ok = await harness.stores.usePages
        .getState()
        .saveLocalPageContent(secondId, [
          { type: "paragraph", content: "This must not be written." },
        ]);

      return {
        ok,
        before,
        after: harness.readMockFile(targetPath),
      };
    });

    expect(result.ok).toBe(false);
    expect(result.after).toBe(result.before);
  });

  test("renaming to an already tracked local filename is rejected", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const harness = (window as LocalHarnessWindow).__gooseTest;
      if (!harness) throw new Error("Local folder harness unavailable");

      const { notebookId } = await harness.setupMockNotebook();
      const pagesStore = harness.stores.usePages.getState();

      const firstId = await pagesStore.createLocalPage(undefined, notebookId);
      if (!firstId) throw new Error("Failed to create first local page");
      await pagesStore.renameLocalPageFile(firstId, "Collision Target");

      const secondId = await pagesStore.createLocalPage(undefined, notebookId);
      if (!secondId) throw new Error("Failed to create second local page");
      const secondPathBefore = harness.stores.usePages.getState().pages[
        secondId
      ]?.localFilePath;

      let errorMessage = "";
      try {
        await harness.stores.usePages
          .getState()
          .renameLocalPageFile(secondId, "Collision Target");
      } catch (error) {
        errorMessage = (error as Error).message;
      }

      return {
        errorMessage,
        firstPath: harness.stores.usePages.getState().pages[firstId]
          ?.localFilePath,
        secondPathBefore,
        secondPathAfter: harness.stores.usePages.getState().pages[secondId]
          ?.localFilePath,
      };
    });

    expect(result.errorMessage).toContain("已存在同名文件");
    expect(result.firstPath).toBe("/mock-notes/Collision Target.md");
    expect(result.secondPathAfter).toBe(result.secondPathBefore);
  });
});
