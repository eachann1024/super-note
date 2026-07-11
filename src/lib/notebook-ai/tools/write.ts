import { tool } from "ai";
import { z } from "zod";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useTabs } from "@/stores/useTabs";
import { getPageTitle } from "@/components/editor/utils/page-title";
import {
  cleanupWriterSession,
  lookupCreatedPage,
  reloadEditorIfActive,
} from "@/lib/notebook-ai/liveWriter";
import { buildAiPageContent } from "@/lib/notebook-ai/markdown";
import {
  guardNotebookForAiWrite,
  guardPageForAiWrite,
  writePageContentSafely,
} from "@/lib/notebook-ai/pageWriteGuard";
import { blocksToMarkdown } from "@/lib/export/blocknoteSerializer";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { NotebookAiAgentContext } from "../types";
import type { JSONContent } from "@/types";

// ----------------------------------------------------------------
// createPage
// ----------------------------------------------------------------
export const createPage = tool({
  description:
    "在当前绑定笔记本新建一篇文章并打开它。markdown 参数需包含完整正文内容（首行不要重复标题）；写作类任务必须用这个工具，且 markdown 参数要输出完整文章。",
  inputSchema: z.object({
    title: z.string().describe("文章标题（不含 # 前缀）"),
    markdown: z
      .string()
      .describe(
        "文章正文，标准 Markdown 格式，首行不要重复标题。待办/进度/清单类内容必须用任务列表语法：`- [ ] 内容`（未完成）/ `- [x] 内容`（已完成），列表项之间不留空行；禁止使用 emoji 和裸 `[x]` 文本。",
      ),
  }),
  execute: async (input, { experimental_context, toolCallId }) => {
    const { notebookId } = experimental_context as NotebookAiAgentContext;

    // 检查 liveWriter 是否已在流式阶段建过该页面（bug 1 fix：避免双重建页）
    const existingPageId = lookupCreatedPage(toolCallId);
    if (existingPageId) {
      const guard = guardPageForAiWrite(existingPageId, {
        expectedNotebookId: notebookId,
      });
      if (!guard.ok) {
        cleanupWriterSession(toolCallId);
        return { pageId: existingPageId, ok: false, error: guard.error };
      }
      // 复用已建页面，只做最终落盘（完整 markdown 写入，标题更新为完整 title）
      const content = buildAiPageContent(input.title, input.markdown);
      const result = await writePageContentSafely(
        existingPageId,
        content as JSONContent,
        { expectedNotebookId: notebookId },
      );
      if (!result.ok) {
        cleanupWriterSession(toolCallId);
        return { pageId: existingPageId, ok: false, error: result.error };
      }
      return { pageId: existingPageId, title: input.title, ok: true };
    }

    // liveWriter 没有预建页（流式未触发或直接调用），走正常新建路径
    const notebookGuard = guardNotebookForAiWrite(notebookId);
    if (!notebookGuard.ok) return { ok: false, error: notebookGuard.error };

    const content = buildAiPageContent(input.title, input.markdown);

    const latestNotebookGuard = guardNotebookForAiWrite(notebookId);
    if (!latestNotebookGuard.ok) {
      return { ok: false, error: latestNotebookGuard.error };
    }
    const notebook = useNotebooks.getState().notebooks[notebookId]!;
    let pageId: string;
    if (notebook.source === "local-folder") {
      // 本地文件夹笔记本走专用路径
      const id = await usePages.getState().createLocalPageRecord({
        workspaceId: notebookId,
        title: input.title,
        content: content as JSONContent,
      });
      if (!id) return { ok: false, error: "创建本地页面失败，内容未保存" };
      pageId = id;
    } else {
      pageId = usePages.getState().createPageRecord({
        workspaceId: notebookId,
        content: content as JSONContent,
      });
    }

    // 打开新建页面（走 tabs 体系，与侧栏点击同链路）
    useTabs.getState().openTab(pageId);
    useNotebooks.getState().setLastActivePage(notebookId, pageId);

    return { pageId, title: input.title, ok: true };
  },
});

// ----------------------------------------------------------------
// updatePage
// ----------------------------------------------------------------
export const updatePage = tool({
  description:
    "用新 Markdown 内容整体替换页面正文（保留页面标题）。用于精简、润色、总结、删除当前页区块等当前页编辑任务；这类任务不要先搜索笔记。pageId 省略时默认更新当前打开页面。markdown 参数为完整正文，首行不要包含标题。",
  inputSchema: z.object({
    pageId: z
      .string()
      .optional()
      .describe("要更新的页面 id；省略则更新当前打开页面"),
    markdown: z
      .string()
      .describe(
        "新的正文内容（Markdown），首行不要包含 # 标题。待办/进度/清单类内容必须用任务列表语法：`- [ ] 内容` / `- [x] 内容`，列表项之间不留空行；禁止使用 emoji 和裸 `[x]` 文本。",
      ),
  }),
  execute: async (input, { experimental_context }) => {
    const { currentPageId, notebookId } =
      experimental_context as NotebookAiAgentContext;
    const pageId =
      input.pageId ?? currentPageId ?? usePages.getState().activePageId ?? "";
    const guard = guardPageForAiWrite(pageId, {
      expectedNotebookId: notebookId,
    });
    if (!guard.ok) return { pageId, ok: false, error: guard.error };
    if (!input.markdown.trim()) {
      return {
        pageId,
        ok: false,
        needsMarkdown: true,
        message:
          "缺少新的页面正文。请先 readPage，再用完整 markdown 调用 updatePage。",
      };
    }

    const title = getPageTitle(guard.page);
    const content = buildAiPageContent(title, input.markdown);

    const result = await writePageContentSafely(
      pageId,
      content as JSONContent,
      { expectedNotebookId: notebookId },
    );
    if (!result.ok) return { pageId, title, ok: false, error: result.error };

    return { pageId, title, ok: true };
  },
});

// ----------------------------------------------------------------
// replaceInPage
// ----------------------------------------------------------------
export const replaceInPage = tool({
  description:
    "在页面中精确替换所有匹配文本。pageId 省略时默认修改当前打开页面。找不到时返回 replacedCount=0 而非报错。批量修改任务应逐页调用，并汇报每页替换结果。",
  inputSchema: z.object({
    pageId: z
      .string()
      .optional()
      .describe("要修改的页面 id；省略则修改当前打开页面"),
    find: z
      .string()
      .optional()
      .default("")
      .describe("要查找的原始文本（精确匹配）"),
    replace: z
      .string()
      .optional()
      .default("")
      .describe("替换后的文本；省略表示删除匹配文本"),
  }),
  execute: async (input, { experimental_context }) => {
    const { currentPageId, notebookId } =
      experimental_context as NotebookAiAgentContext;
    const pageId =
      input.pageId ?? currentPageId ?? usePages.getState().activePageId ?? "";
    const guard = guardPageForAiWrite(pageId, {
      expectedNotebookId: notebookId,
    });
    if (!guard.ok) {
      return { pageId, replacedCount: 0, ok: false, error: guard.error };
    }
    const title = getPageTitle(guard.page);
    if (!input.find.trim()) {
      return {
        pageId,
        title,
        replacedCount: 0,
        skipped: true,
        message:
          "缺少要精确替换的 find 文本。结构性编辑当前页时，请先 readPage，再调用 updatePage 写入完整正文。",
      };
    }

    // 先序列化为 markdown，做字符串替换，再写回
    const expectedRevision = {
      updatedAt: guard.updatedAt,
      contentSignature: guard.contentSignature,
    };
    const currentMd = await blocksToMarkdown(
      guard.page.content as BlockNoteContent,
    );
    const afterSerializeGuard = guardPageForAiWrite(pageId, {
      expectedNotebookId: notebookId,
      expectedRevision,
    });
    if (!afterSerializeGuard.ok) {
      return {
        pageId,
        title,
        replacedCount: 0,
        ok: false,
        error: afterSerializeGuard.error,
      };
    }
    const count = currentMd.split(input.find).length - 1;
    if (count === 0) return { pageId, title, replacedCount: 0 };

    const newMd = currentMd.split(input.find).join(input.replace);
    const newContent = buildAiPageContent(title, newMd);

    const result = await writePageContentSafely(
      pageId,
      newContent as JSONContent,
      { expectedNotebookId: notebookId, expectedRevision },
    );
    if (!result.ok) {
      return {
        pageId,
        title,
        replacedCount: 0,
        ok: false,
        error: result.error,
      };
    }
    reloadEditorIfActive(pageId);

    return { pageId, title, replacedCount: count, ok: true };
  },
});
