import { tool } from "ai";
import { z } from "zod";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { getPageTitle } from "@/components/editor/utils/page-title";
import {
  extractTextFromContent,
} from "@/components/editor/utils/content-text-extractor";
import { blocksToMarkdown } from "@/lib/export/blocknoteSerializer";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { NotebookAiAgentContext } from "../types";

// ----------------------------------------------------------------
// listNotebooks
// ----------------------------------------------------------------
export const listNotebooks = tool({
  description: "列出所有笔记本，包含 id、名称和是否为当前笔记本。",
  inputSchema: z.object({}),
  execute: async (_input, { experimental_context }) => {
    const { notebookId: currentNotebookId } =
      experimental_context as NotebookAiAgentContext;
    const notebooks = useNotebooks.getState().notebooks;
    return Object.values(notebooks).map((nb) => ({
      id: nb.id,
      name: nb.name,
      isCurrent: nb.id === currentNotebookId,
    }));
  },
});

// ----------------------------------------------------------------
// listPages
// ----------------------------------------------------------------
export const listPages = tool({
  description:
    "列出指定笔记本（默认为当前绑定笔记本）中所有未删除的页面，返回页面 id、标题和最近更新时间。",
  inputSchema: z.object({
    notebookId: z
      .string()
      .optional()
      .describe("指定笔记本 id；省略则使用当前绑定笔记本"),
  }),
  execute: async (input, { experimental_context }) => {
    const { notebookId: boundNotebookId } =
      experimental_context as NotebookAiAgentContext;
    const targetId = input.notebookId ?? boundNotebookId;
    const pages = usePages.getState().pages;
    return Object.values(pages)
      .filter((p) => p.workspaceId === targetId && !p.trashedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((p) => ({
        pageId: p.id,
        title: getPageTitle(p),
        updatedAt: p.updatedAt,
      }));
  },
});

// ----------------------------------------------------------------
// searchNotes
// ----------------------------------------------------------------
export const searchNotes = tool({
  description:
    "在笔记内容中全文搜索。仅用于跨页面查找或目标页面不明确的任务；当前页编辑、润色、总结、删除区块时不要调用。scope='notebook' 只搜当前绑定笔记本；scope='all' 搜索所有笔记本（会预加载本地文件夹笔记本）。返回匹配页面列表含命中上下文片段。query 为空时返回空结果。",
  inputSchema: z.object({
    query: z.string().optional().default("").describe("搜索关键词"),
    scope: z
      .enum(["notebook", "all"])
      .default("notebook")
      .describe("搜索范围：notebook=当前笔记本，all=所有笔记本"),
  }),
  execute: async (input, { experimental_context }) => {
    const { notebookId: boundNotebookId } =
      experimental_context as NotebookAiAgentContext;
    const query = input.query.trim();
    if (!query) return [];

    // scope=all 时预加载所有本地文件夹笔记本
    if (input.scope === "all") {
      await usePages.getState().loadAllLocalFolderPages();
    }

    const pages = usePages.getState().pages;
    const notebooks = useNotebooks.getState().notebooks;
    const queryLower = query.toLowerCase();

    // 把 query 按分隔符切成 ≥2 字的词项（用于降级分词匹配）
    const queryTerms = queryLower
      .split(/[\s,，。、？！?!]+/)
      .filter((t) => t.length >= 2);

    /** 对原始文本打分并返回命中位置 */
    function scoreText(rawText: string): { score: number; matchIdx: number } {
      const lower = rawText.toLowerCase();
      let score = 0;
      let matchIdx = -1;

      // 整短语匹配，每次命中 10 分
      let searchFrom = 0;
      while (true) {
        const idx = lower.indexOf(queryLower, searchFrom);
        if (idx === -1) break;
        if (score === 0) matchIdx = idx;
        score += 10;
        searchFrom = idx + queryLower.length;
      }

      // 分词命中（仅当整短语 0 分时启用作为降级）
      if (score === 0 && queryTerms.length >= 1) {
        for (const term of queryTerms) {
          let sf = 0;
          while (true) {
            const idx = lower.indexOf(term, sf);
            if (idx === -1) break;
            if (matchIdx === -1) matchIdx = idx;
            score += 1;
            sf = idx + term.length;
          }
        }
      }

      return { score, matchIdx };
    }

    const candidates: Array<{
      score: number;
      matchIdx: number;
      rawCombined: string;
      pageId: string;
      notebookId: string;
      notebookName: string;
      title: string;
    }> = [];

    for (const page of Object.values(pages)) {
      if (page.trashedAt) continue;
      if (input.scope === "notebook" && page.workspaceId !== boundNotebookId)
        continue;

      const title = getPageTitle(page);
      const bodyText = extractTextFromContent(page.content);
      // 用原始大小写文本，保留正文真实字符，分词匹配在内部 toLowerCase
      const rawCombined = `${title}\n${bodyText}`;

      const { score, matchIdx } = scoreText(rawCombined);
      if (score === 0) continue;

      const nb = notebooks[page.workspaceId];
      candidates.push({
        score,
        matchIdx,
        rawCombined,
        pageId: page.id,
        notebookId: page.workspaceId,
        notebookName: nb?.name ?? page.workspaceId,
        title,
      });
    }

    // 按分数降序，最多 20 条
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 20);

    return top.map(({ pageId, notebookId, notebookName, title, rawCombined, matchIdx }) => {
      // 从原始文本（保留大小写）截取 snippet
      const safeIdx = Math.max(0, matchIdx);
      const start = Math.max(0, safeIdx - 60);
      const end = Math.min(rawCombined.length, safeIdx + query.length + 60);
      let snippet = rawCombined.slice(start, end);
      if (start > 0) snippet = "…" + snippet;
      if (end < rawCombined.length) snippet = snippet + "…";

      return { pageId, notebookId, notebookName, title, snippet };
    });
  },
});

// ----------------------------------------------------------------
// readPage
// ----------------------------------------------------------------
export const readPage = tool({
  description:
    "读取页面完整内容，返回标题和 Markdown 格式正文。当前页任务可省略 pageId，默认读取当前打开页面。",
  inputSchema: z.object({
    pageId: z.string().optional().describe("页面 id；省略则读取当前打开页面"),
  }),
  execute: async (input, { experimental_context }) => {
    const { currentPageId } = experimental_context as NotebookAiAgentContext;
    const pageId = input.pageId ?? currentPageId ?? usePages.getState().activePageId ?? "";
    const page = usePages.getState().pages[pageId];
    if (!page) {
      return { error: pageId ? `页面 ${pageId} 不存在` : "当前没有打开页面" };
    }
    const title = getPageTitle(page);
    const markdown = await blocksToMarkdown(
      page.content as BlockNoteContent,
    );
    return { title, markdown };
  },
});
