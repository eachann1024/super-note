import type { Page } from "@/types";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { extractTitleFromContent } from "@/components/editor/utils/content-text-extractor";
import {
  normalizePageContent,
  createEmptyBlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import {
  blocksToMarkdown,
  blocksToHTML,
  EXPORT_HTML_HEAD_ASSETS,
  EXPORT_HTML_BODY_SCRIPTS,
} from "./blocknoteSerializer";
import { inlineImagesAsBase64 } from "./inlineImagesBase64";
import { importFromMarkdown, type ImportResult } from "./markdown/parse";
import { saveBlobAndReveal, triggerBrowserDownload } from "./fileSave";

export { jsonContentToMarkdown } from "./markdown/serialize";
export { blocksToMarkdown, blocksToHTML } from "./blocknoteSerializer";
export {
  importFromMarkdown,
  importMarkdownFragment,
  type ImportResult,
} from "./markdown/parse";
export {
  exportNotebooks,
  generateExportZip,
  importNotebooksFromZip,
  type ExportOptions,
} from "./zipBundle";
export { saveBlobAndReveal } from "./fileSave";
export { exportToPDF } from "@/lib/pdfExport";

function cloneContent(content: BlockNoteContent): any[] {
  return structuredClone(content ?? []) as any[];
}

function stripFirstH1(blocks: any[]): any[] {
  if (blocks[0]?.type === "heading" && blocks[0]?.props?.level === 1) {
    return blocks.slice(1);
  }
  return blocks;
}

async function downloadBlob(blob: Blob, filename: string) {
  try {
    const saved = await saveBlobAndReveal(blob, filename);
    if (saved) return;
  } catch (error) {
    console.error("[export] saveBlobAndReveal 失败，尝试浏览器下载:", error);
  }

  if (triggerBrowserDownload(blob, filename)) return;

  throw new Error("导出失败：无法保存文件");
}

function downloadFile(content: string, filename: string, contentType: string) {
  try {
    const blob = new Blob([content], { type: contentType });
    void downloadBlob(blob, filename);
  } catch (error) {
    console.error("下载失败:", error);
    throw error;
  }
}

export function exportToJSON(page: Page) {
  const data = JSON.stringify(page, null, 2);
  const title = extractTitleFromContent(page.content);
  downloadFile(data, `${title || "untitled"}.json`, "application/json");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function exportToMarkdown(page: Page) {
  const blocks = stripFirstH1(cloneContent(page.content));
  await inlineImagesAsBase64(blocks);
  const markdown = await blocksToMarkdown(blocks);
  const title = extractTitleFromContent(page.content);
  const fullMarkdown = `# ${title}\n\n${markdown}`;
  downloadFile(fullMarkdown, `${title || "untitled"}.md`, "text/markdown");
}

export async function exportToHTML(page: Page) {
  const blocks = stripFirstH1(cloneContent(page.content));
  await inlineImagesAsBase64(blocks);
  const bodyHtml = await blocksToHTML(blocks);
  const title = extractTitleFromContent(page.content);
  const fullHtml = renderExportHtml(title, bodyHtml);
  downloadFile(fullHtml, `${title || "untitled"}.html`, "text/html");
}

export function renderExportHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtmlText(title)}</title>
${EXPORT_HTML_HEAD_ASSETS}
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 2rem; line-height: 1.65; color: #1f2329; }
img { max-width: 100%; height: auto; }
blockquote { border-left: 3px solid #d0d7de; padding: 0 1rem; color: #57606a; margin: 1rem 0; }
code { background: #f2f3f5; color: #1f2329; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.88em; }
pre { background: #f6f8fa; padding: 1rem; overflow-x: auto; border-radius: 6px; }
pre code { background: transparent; padding: 0; }
pre.mermaid { background: transparent; padding: 0; text-align: center; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
table th, table td { border: 1px solid #d0d7de; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
table th { background: #f6f8fa; font-weight: 600; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.5rem 0; }
ul, ol { padding-left: 1.5rem; }
a { color: #0969da; }
h1, h2, h3, h4 { line-height: 1.3; margin-top: 1.5em; }
.katex-display { overflow-x: auto; overflow-y: hidden; }
input[type="checkbox"] { margin-right: 0.4em; }
</style>
</head>
<body>
<h1>${escapeHtmlText(title)}</h1>
${bodyHtml}
${EXPORT_HTML_BODY_SCRIPTS}
</body>
</html>`;
}

export function importFromJSON(
  jsonString: string,
  filename?: string,
): ImportResult {
  try {
    const data = JSON.parse(jsonString) as any;

    if (!data.content || typeof data.content !== "object") {
      return {
        title: "",
        content: createEmptyBlockNoteContent(),
        success: false,
        error: "无效的 JSON 格式：缺少 content 字段",
      };
    }

    let title = filename || "导入的页面";
    if ("title" in data && data.title) {
      title = data.title;
    } else {
      title = extractTitleFromContent(data.content) || filename || "导入的页面";
    }

    return {
      title,
      content: normalizePageContent(data.content),
      success: true,
    };
  } catch (e) {
    return {
      title: "",
      content: createEmptyBlockNoteContent(),
      success: false,
      error: "解析 JSON 失败",
    };
  }
}

export function importFile(): Promise<ImportResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.md,.markdown,.txt";

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve({
          title: "",
          content: createEmptyBlockNoteContent(),
          success: false,
          error: "未选择文件",
        });
        return;
      }

      const text = await file.text();
      const ext = file.name.split(".").pop()?.toLowerCase();
      const filename = file.name.replace(/\.[^/.]+$/, "");

      if (ext === "json") {
        resolve(importFromJSON(text, filename));
      } else if (ext === "md" || ext === "markdown" || ext === "txt") {
        resolve(importFromMarkdown(text, filename));
      } else {
        resolve({
          title: "",
          content: createEmptyBlockNoteContent(),
          success: false,
          error: "不支持的文件格式",
        });
      }
    };

    input.click();
  });
}
