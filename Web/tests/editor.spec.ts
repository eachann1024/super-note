import { expect, test, type Page } from "@playwright/test";

async function openSidebarIfNeeded(page: Page) {
  const showSidebar = page.getByRole("button", { name: "显示侧边栏" });
  if (await showSidebar.isVisible()) await showSidebar.click();
}

async function closeCompactSidebarIfNeeded(page: Page) {
  const closeSidebar = page.getByRole("button", { name: "关闭侧边栏" });
  if (await closeSidebar.isVisible()) await closeSidebar.click();
}

function editorBody(page: Page) {
  return page.locator(".bn-editor:visible, .markdown-source:visible");
}

async function expectEditorToContain(page: Page, text: string) {
  await expect.poll(async () => editorBody(page).evaluate((element) => (
    element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? ""
  ))).toContain(text);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/harness.html");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("editor-surface")).toBeVisible();
  await page.waitForTimeout(250);
  expect(errors).toEqual([]);
});

test("启动后默认高亮首个文件且工具栏不遮挡编辑区", async ({ page }) => {
  await openSidebarIfNeeded(page);
  const currentFile = page.locator('.page-row[aria-current="page"]');
  await expect(currentFile).toContainText("五一千岛湖露营.md");
  await expect(page.getByRole("textbox", { name: "文件名" })).toHaveValue("五一千岛湖露营");
  await expect(page.getByTestId("editor-document")).toBeVisible();

  const geometry = await page.evaluate(() => {
    const toolbar = document.querySelector(".harness-toolbar")!.getBoundingClientRect();
    const editor = document.querySelector(".harness-editor")!.getBoundingClientRect();
    const documentSurface = document.querySelector(".editor-page")!.getBoundingClientRect();
    return { toolbarBottom: toolbar.bottom, editorTop: editor.top, documentTop: documentSurface.top };
  });
  expect(geometry.toolbarBottom).toBeLessThanOrEqual(geometry.editorTop + 1);
  expect(geometry.documentTop).toBeGreaterThanOrEqual(geometry.editorTop);
});

test("打开文件夹后默认选择首个 Markdown 并可切换输入", async ({ page }) => {
  await openSidebarIfNeeded(page);
  await page.getByRole("button", { name: "打开文件夹" }).first().click();
  await expect(page.locator(".notebook-title strong")).toHaveText("super-note");
  await expect(page.locator('.page-row[aria-current="page"]')).toContainText("README.md");
  await expect(page.getByRole("textbox", { name: "文件名" })).toHaveValue("README");

  await page.locator(".page-row").filter({ hasText: "docs/CHANGELOG.md" }).click();
  await closeCompactSidebarIfNeeded(page);
  await expect(page.locator('.page-row[aria-current="page"]')).toContainText("docs/CHANGELOG.md");
  await expect(page.getByRole("textbox", { name: "文件名" })).toHaveValue("CHANGELOG");
  const editor = page.locator('.bn-editor:visible, .markdown-source:visible');
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n文件夹切换后可以继续输入");
  await expectEditorToContain(page, "文件夹切换后可以继续输入");
  await expect(page.locator(".save-status")).toContainText("已保存到磁盘", { timeout: 4000 });
});

test("新建 Markdown 文件并编辑后显示已保存到磁盘", async ({ page }) => {
  await openSidebarIfNeeded(page);
  await page.getByRole("button", { name: "新建 Markdown 文件" }).last().click();
  await closeCompactSidebarIfNeeded(page);
  const filename = page.getByRole("textbox", { name: "文件名" });
  await expect(filename).toHaveValue("未命名");
  await filename.fill("周一工作记录");
  const editor = editorBody(page);
  await editor.click();
  await page.keyboard.type("完成本地 Markdown 文件保存");
  await expect(page.locator(".save-status")).toContainText("已保存到磁盘", { timeout: 4000 });
  await expect(page.getByRole("tab", { name: "周一工作记录.md" })).toBeVisible();
});

test("打开多个本地文件并在标签之间切换", async ({ page }) => {
  await openSidebarIfNeeded(page);
  await page.locator(".page-row").filter({ hasText: "七月阅读清单.md" }).click();
  await page.locator(".page-row").filter({ hasText: "零散想法.md" }).click();
  await closeCompactSidebarIfNeeded(page);
  await expect(page.getByRole("tab", { name: "七月阅读清单.md" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "零散想法.md" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "文件名" })).toHaveValue("零散想法");
});

test("搜索已打开文件的文件名与 Markdown 正文", async ({ page }) => {
  await openSidebarIfNeeded(page);
  await page.getByRole("button", { name: /搜索文件夹中的 Markdown/ }).click();
  await page.getByRole("textbox", { name: "搜索文件名和正文" }).fill("气泡水");
  await page.getByRole("option", { name: /五一千岛湖露营.md/ }).click();
  await expect(page.getByRole("textbox", { name: "文件名" })).toHaveValue("五一千岛湖露营");
  await expectEditorToContain(page, "气泡水");
});

test("深色模式、侧边栏与紧凑窗口状态正确", async ({ page }, testInfo) => {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "切换到深色模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if (testInfo.project.name === "compact") {
    await expect(page.locator(".harness-sidebar")).toHaveClass(/is-collapsed/);
    await page.getByRole("button", { name: "显示侧边栏" }).click();
    await expect(page.getByRole("button", { name: /搜索文件夹中的 Markdown/ })).toBeVisible();
    await page.getByRole("button", { name: "关闭侧边栏" }).click();
    await expect(page.locator(".harness-sidebar")).toHaveClass(/is-collapsed/);
  } else {
    await page.getByRole("button", { name: "隐藏侧边栏" }).click();
    await expect(page.locator(".harness-sidebar")).toHaveAttribute("aria-hidden", "true");
    await page.getByRole("button", { name: "显示侧边栏" }).click();
    await expect(page.locator(".harness-sidebar")).not.toHaveClass(/is-collapsed/);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("保存后切换文件再返回可恢复当前会话内容", async ({ page }) => {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n会话内恢复内容");
  await expect(page.locator(".save-status")).toContainText("已保存到磁盘", { timeout: 4000 });

  await openSidebarIfNeeded(page);
  await page.locator(".page-row").filter({ hasText: "七月阅读清单.md" }).click();
  await page.locator(".page-row").filter({ hasText: "五一千岛湖露营.md" }).click();
  await closeCompactSidebarIfNeeded(page);
  await expectEditorToContain(page, "会话内恢复内容");
});

test("无法无损转换的 Markdown 使用源码模式且未编辑时原样提交", async ({ page }) => {
  await openSidebarIfNeeded(page);
  await page.locator(".page-row").filter({ hasText: "源码保真.md" }).click();
  await closeCompactSidebarIfNeeded(page);

  const source = page.getByRole("textbox", { name: "Markdown 源码" });
  const original = "---\ntitle: 原样保留\ntags: [本地, Markdown]\n---\n\n<div data-note=\"raw\">HTML</div>\n";
  await expect(source).toHaveValue(original);
  await expect(page.getByText("已切换为源码编辑以保护原文", { exact: false })).toBeVisible();

  const draft = await page.evaluate(() => window.gooseEditor.flushAndGetDraft());
  expect(draft.hasChanges).toBe(false);
  expect(draft.markdown).toBe(original);
});

test("搜索层支持 Escape 关闭并将焦点还给触发按钮", async ({ page }) => {
  await openSidebarIfNeeded(page);
  const trigger = page.getByRole("button", { name: /搜索文件夹中的 Markdown/ });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "搜索已打开文件" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "搜索已打开文件" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("关闭最后一个标签后显示本地文件空状态", async ({ page }) => {
  await page.getByRole("button", { name: "关闭五一千岛湖露营.md" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByText("新建或打开 Markdown 文件开始写作")).toBeVisible();
});
