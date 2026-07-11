import { ToolLoopAgent, generateText, stepCountIs } from "ai";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { blocksToMarkdown } from "@/lib/export/blocknoteSerializer";
import { buildLanguageModel } from "./model";
import { notebookAiTools } from "./tools";
import { getCurrentNotebookAiPageId } from "./context";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { LanguageModel } from "ai";
import type { ModelAvailability } from "./model";
import type { NotebookAiAgentContext } from "./types";

/** 构建注入了笔记本上下文的 system prompt */
function buildSystemPrompt(
  notebookId: string,
  currentPageId?: string | null,
): string {
  const notebook = useNotebooks.getState().notebooks[notebookId];
  const notebookName = notebook?.name ?? "未知笔记本";

  const pages = usePages.getState().pages;
  const activePageId =
    currentPageId ?? getCurrentNotebookAiPageId(notebookId);
  const activePage =
    activePageId && pages[activePageId]?.workspaceId === notebookId
      ? pages[activePageId]
      : undefined;
  const activePageLine =
    activePage && !activePage.trashedAt
      ? `[${activePage.id}] ${getPageTitle(activePage)}`
      : "（无当前打开页面）";

  // 取当前笔记本最近页面标题摘要，给模型定位用；正文需要时再 readPage。
  const notebookPages = Object.values(pages)
    .filter((p) => p.workspaceId === notebookId && !p.trashedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20);

  const pageList =
    notebookPages.length > 0
      ? notebookPages
          .map(
            (p) =>
              `- [${p.id}] ${getPageTitle(p)}${p.id === activePage?.id ? "（当前打开）" : ""}`,
          )
          .join("\n")
      : "（暂无页面）";

  return `你是「${notebookName}」笔记本的 AI 助手，帮助用户管理和创作笔记内容。

当前笔记本：${notebookName}（id: ${notebookId}）

当前打开页面：${activePageLine}

当前笔记本页面（最近 20 页，仅标题索引，正文需按需读取）：
${pageList}

## 工具使用守则

1. **当前页面优先**：用户说“这个页面 / 当前页面 / 本文 / 这篇”时，直接对“当前打开页面”使用 readPage；不要先 searchNotes，也不要 listPages。用户要求精简、润色、总结、改写当前页时，禁止 searchNotes。当前页面来自用户发送本轮消息时的活动页签，不要被后续新建页面或切换页面影响。
2. **搜索必须克制**：只有用户明确要求跨页搜索，或目标页面不明确时才用 searchNotes。一次请求默认最多调用 1 次 searchNotes；只有搜索结果明显不够且查询词实质不同，才允许再搜一次。
3. **读取必须克制**：只读取实际需要回答或修改的页面。不要批量读取页面；不要为了润色当前页去读其它笔记。
4. **写作类任务必须用 createPage**：创建新文章时调用 createPage 工具，markdown 参数输出完整正文，首行不要重复标题。
5. **批量修改用 replaceInPage**：需要在多页修改内容时，逐页调用 replaceInPage 并汇报每页替换结果。
6. **表格数据用 showTable**：展示结构化数据时使用 showTable 工具。
7. **数值对比/趋势用 showChart**：展示数值对比或趋势时使用 showChart 工具。
8. **流程/结构/关系/架构图用 showDiagram**：当用户要流程图、时序图、关系图、架构图、Mermaid 图时，调用 showDiagram，source 只输出 Mermaid DSL，不要在正文重复贴源码。
9. **SVG/矢量图用 showSvg**：只有用户明确要求“SVG / 矢量图 / 图标 / 示意图”时才调用 showSvg；svg 必须是完整 <svg>，禁止脚本、事件属性、foreignObject、外链资源。
10. **可视化回复要安静**：调用 showChart / showDiagram / showSvg 后，最终回复只给一句必要说明，不要重复输出图表源码、工具名或 JSON。
11. **回答使用用户语言**：用户使用中文则用中文回答，使用英文则用英文回答。
12. **不要编造内容**：若笔记本中没有相关内容，如实告知用户。

## 输出格式规范（对话回复与写入笔记的 markdown 都必须严格遵守）

### 任务/进度/清单 → 必须用任务列表语法

**判定标准**：只要一个条目带有「完成状态」（已完成 / 进行中 / 未开始 / 待办 / 打勾 / done / 工期+进度 等），它就是任务项，整组必须用任务列表表达，每行都以 \`- [x] \`（已完成）或 \`- [ ] \`（未完成/进行中/未开始）开头。同一组清单每一行都要带前缀，不能只给前几行加、其余掉回普通段落。

正确示范（每行都带前缀）：
- [x] 系统分析（1天）— 已完成
- [ ] 需求分析（0.5天）— 进行中
- [ ] 登录注册（0.2天）— 未开始

以下写法一律禁止：用引用块 \`>\` 强调（引用块只能引述原文）、写成加粗段落 \`**xx**：已完成\`、裸标记缺 \`- \` 前缀如 \`[x] xx\`、一组里只有前几行带前缀其余掉回段落。

### 其它格式约束

1. **禁止使用 emoji**（包括 ✅ ❌ ⬜ ▶ 等符号）。完成状态用打勾语法或「已完成 / 进行中 / 未开始」等文字表达。
2. **列表保持紧凑**：列表项之间不插空行；任务文本用纯文本，不加多余的装饰符号（如 \`_\`、\`~\`、成对短横线）。
3. **结构清晰**：正文用标题、列表、表格组织；不用连续符号画分隔线；引用块 \`>\` 只用于引述他人原文。

保持回答简洁清晰，聚焦用户的实际需求。`;
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const obj = part as Record<string, unknown>;
      if (typeof obj.text === "string") return obj.text;
      if (typeof obj.content === "string") return obj.content;
      if (typeof obj.output === "string") return obj.output;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getLastUserRequest(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (msg?.role !== "user") continue;
    const text = textFromMessageContent(msg.content);
    if (text.trim()) return text.trim();
  }
  return "";
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
}

function findMentionedMarkdownSection(markdown: string, userRequest: string): string {
  const headings = [...markdown.matchAll(/^(#{2,6})\s+(.+?)\s*$/gm)].map(
    (match) => ({
      level: match[1].length,
      title: match[2].trim(),
      index: match.index ?? 0,
    }),
  );
  if (headings.length === 0) return "";

  const normalizedRequest = userRequest.replace(/\s+/g, "");
  const target =
    headings.find((heading) =>
      normalizedRequest.includes(heading.title.replace(/\s+/g, "")),
    ) ??
    headings.find((heading) =>
      heading.title.includes("示例") && normalizedRequest.includes("示例"),
    );
  if (!target) return "";

  const next = headings.find(
    (heading) => heading.index > target.index && heading.level <= target.level,
  );
  return markdown.slice(target.index, next?.index ?? markdown.length).trimEnd();
}

function hasCompletedWriteTool(steps: Array<{ toolResults?: Array<unknown> }>): boolean {
  return steps.some((step) =>
    step.toolResults?.some((result) => {
      if (!result || typeof result !== "object") return false;
      const toolName = (result as Record<string, unknown>).toolName;
      return (
        toolName === "createPage" ||
        toolName === "updatePage" ||
        toolName === "replaceInPage"
      );
    }),
  );
}

async function repairUpdatePageToolCall(options: {
  toolCall: {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: string;
    [key: string]: unknown;
  };
  messages: unknown[];
  model: LanguageModel;
  currentPageId?: string | null;
}) {
  const activePageId = options.currentPageId ?? usePages.getState().activePageId;
  const page = activePageId ? usePages.getState().pages[activePageId] : undefined;
  if (!activePageId || !page) return null;

  const userRequest = getLastUserRequest(options.messages);
  const title = getPageTitle(page);
  const currentMarkdown = await blocksToMarkdown(page.content as BlockNoteContent);

  const result = await generateText({
    model: options.model,
    prompt: `你正在修复一个笔记工具调用。模型刚才错误地调用了 updatePage，但没有提供 markdown。

请根据用户请求，改写“当前页面 Markdown”，只输出新的正文 Markdown。

规则：
- 不要输出 JSON。
- 不要包裹代码围栏。
- 不要重复页面标题。
- 保留用户没有要求删除或修改的内容。
- 如果用户要求删除某个区块，删除对应标题和其下内容。
- 如果用户要求精简或润色，保留核心信息，删掉啰嗦示例。

用户请求：
${userRequest || "按用户最近的要求更新当前页面"}

页面标题：
${title}

当前页面 Markdown：
${currentMarkdown}`,
  });

  const markdown = stripMarkdownFence(result.text);
  if (!markdown) return null;

  return {
    ...options.toolCall,
    input: JSON.stringify({ pageId: activePageId, markdown }),
  };
}

async function repairReplaceInPageToolCall(options: {
  toolCall: {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: string;
    [key: string]: unknown;
  };
  messages: unknown[];
  currentPageId?: string | null;
}) {
  const activePageId = options.currentPageId ?? usePages.getState().activePageId;
  const page = activePageId ? usePages.getState().pages[activePageId] : undefined;
  if (!activePageId || !page) return null;

  const userRequest = getLastUserRequest(options.messages);
  const currentMarkdown = await blocksToMarkdown(page.content as BlockNoteContent);
  const section = findMentionedMarkdownSection(currentMarkdown, userRequest);
  if (!section) {
    return {
      ...options.toolCall,
      input: JSON.stringify({ pageId: activePageId, find: "", replace: "" }),
    };
  }

  return {
    ...options.toolCall,
    input: JSON.stringify({ pageId: activePageId, find: section, replace: "" }),
  };
}

export type BuildAgentResult =
  | { ok: true; agent: ToolLoopAgent<never, typeof notebookAiTools> }
  | { ok: false; reason: string };

/**
 * 构建绑定指定笔记本的 ToolLoopAgent。
 * 每次调用都会重新构建以获取最新的笔记本上下文。
 */
export function buildNotebookAgent(
  notebookId: string,
  currentPageId?: string | null,
): BuildAgentResult {
  const agentContext: NotebookAiAgentContext = {
    notebookId,
    currentPageId: currentPageId ?? getCurrentNotebookAiPageId(notebookId),
  };
  const modelResult: ModelAvailability = buildLanguageModel({
    executeTool: async ({ toolName, input, toolCallId, signal }) => {
      const selectedTool = notebookAiTools[toolName as keyof typeof notebookAiTools];
      const execute = selectedTool?.execute;
      if (typeof execute !== "function") {
        throw new Error(`AI 请求了未知工具：${toolName}`);
      }

      const output = execute(input as never, {
        toolCallId,
        messages: [],
        abortSignal: signal,
        experimental_context: agentContext,
      });
      if (
        output &&
        typeof output === "object" &&
        Symbol.asyncIterator in output
      ) {
        let lastValue: unknown = null;
        for await (const value of output as AsyncIterable<unknown>) {
          lastValue = value;
        }
        return lastValue;
      }
      return await output;
    },
  });
  if (!modelResult.ok) {
    return { ok: false, reason: modelResult.reason };
  }

  const agent = new ToolLoopAgent({
    model: modelResult.model,
    tools: notebookAiTools,
    instructions: buildSystemPrompt(notebookId, agentContext.currentPageId),
    stopWhen: stepCountIs(6),
    experimental_context: agentContext,
    prepareStep: ({ steps }) => {
      if (hasCompletedWriteTool(steps)) {
        return { activeTools: [] };
      }
      return undefined;
    },
    experimental_repairToolCall: async (options) => {
      if (options.toolCall.toolName === "updatePage") {
        try {
          const parsed = JSON.parse(options.toolCall.input || "{}") as {
            markdown?: unknown;
          };
          if (typeof parsed.markdown === "string" && parsed.markdown.trim()) {
            return null;
          }
        } catch {
          // 继续走修复：坏 JSON 和空 markdown 都按同一条链路处理。
        }

        return repairUpdatePageToolCall({
          toolCall: options.toolCall,
          messages: options.messages,
          model: modelResult.model,
          currentPageId: agentContext.currentPageId,
        });
      }

      if (options.toolCall.toolName === "replaceInPage") {
        try {
          const parsed = JSON.parse(options.toolCall.input || "{}") as {
            find?: unknown;
          };
          if (typeof parsed.find === "string" && parsed.find.trim()) {
            return null;
          }
        } catch {
          // 继续走修复：坏 JSON 和空 find 都按同一条链路处理。
        }

        return repairReplaceInPageToolCall({
          toolCall: options.toolCall,
          messages: options.messages,
          currentPageId: agentContext.currentPageId,
        });
      }

      return null;
    },
  });

  return { ok: true, agent };
}
