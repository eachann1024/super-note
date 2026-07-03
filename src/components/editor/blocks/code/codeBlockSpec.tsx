import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { createReactBlockSpec } from "@blocknote/react";
import { createExtension, defaultProps } from "@blocknote/core";
import { createHighlightPlugin, type Parser } from "@/components/editor/find/highlightPlugin";
import { createParser as createLowlightParser } from "prosemirror-highlight/lowlight";
import { Decoration } from "prosemirror-view";
import { common, createLowlight } from "lowlight";
import * as LucideIcons from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CodeBlockToolbar } from "./CodeBlockToolbar";
import { MathView } from "@/components/editor/blocks/math/MathView";
import { MermaidView } from "@/components/editor/blocks/mermaid/MermaidView";
import { useEditorSettings } from "@/components/editor/platform/hostContext";
import { renderMermaidSvgForExport } from "@/lib/imageExport/mermaid";

// 主应用与速记小窗均以 highlight.js common（~37 种常用语言）作为代码高亮基线，
// 把语法包从 ~1MB（all 全量）降到 ~300KB（vendor-markdown 1257KB→530KB）。
// 注意：不做小众语言运行时按需加载——vite/rolldown 对 node_modules 既无法 code-split
// 裸包模板字符串，import.meta.glob 又会把全部 192 种语言 eager 内联进首屏（体积反弹到
// 1.4MB，是负优化）。故 common 外语言一律同步降级为无高亮纯文本（不报错），由 failedSet 记录。
const lowlight = createLowlight(common);
const lowlightParser = createLowlightParser(lowlight);
const loadedLanguagesSet = new Set(lowlight.listLanguages());

// common 外语言加入 failedSet → 走同步纯文本降级，不返回 Promise，
// 杜绝「Promise → refresh → dispatch → 重算」的无限循环。
const failedLangsSet = new Set<string>();

const LANGUAGE_ALIASES: Record<string, string> = {
  // 常见 shell 别名
  sh: "bash",
  shell: "bash",
  // C/C++
  "c++": "cpp",
  // C#
  "c#": "csharp",
  cs: "csharp",
  // Go
  golang: "go",
  // LaTeX
  tex: "latex",
  math: "latex",
  // YAML
  yml: "yaml",
  // Markdown
  md: "markdown",
  mkdown: "markdown",
  mkd: "markdown",
  // Python
  py: "python",
  // TypeScript
  ts: "typescript",
  tsx: "typescript",
  // JavaScript
  js: "javascript",
  jsx: "javascript",
  // Rust
  rs: "rust",
  // Ruby
  rb: "ruby",
  // Objective-C
  objc: "objectivec",
  objectc: "objectivec",
  // CoffeeScript
  coffee: "coffeescript",
  // PowerShell
  ps1: "powershell",
  ps: "powershell",
  // Kotlin
  kt: "kotlin",
  // Dockerfile
  docker: "dockerfile",
};

const SKIP_HIGHLIGHT_LANGUAGES = new Set([
  "none",
]);

const AUTO_HIGHLIGHT_LANGUAGES = new Set([
  "plain",
  "plaintext",
  "text",
  "txt",
]);

function normalizeHighlightLanguage(language: string | undefined) {
  const normalized = (language || "text").trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function createRegexDecorations(
  content: string,
  pos: number,
  patterns: Array<{ regex: RegExp; className: string }>,
) {
  const decorations: Decoration[] = [];

  patterns.forEach(({ regex, className }) => {
    for (const match of content.matchAll(regex)) {
      if (match.index === undefined || !match[0]) continue;
      decorations.push(
        Decoration.inline(pos + 1 + match.index, pos + 1 + match.index + match[0].length, {
          class: className,
        }),
      );
    }
  });

  return decorations;
}

function createRegexCaptureDecorations(
  content: string,
  pos: number,
  patterns: Array<{ regex: RegExp; captureGroup: number; className: string }>,
) {
  const decorations: Decoration[] = [];

  patterns.forEach(({ regex, captureGroup, className }) => {
    for (const match of content.matchAll(regex)) {
      const text = match[captureGroup];
      if (match.index === undefined || !text) continue;
      const offset = match[0].indexOf(text);
      if (offset < 0) continue;
      decorations.push(
        Decoration.inline(
          pos + 1 + match.index + offset,
          pos + 1 + match.index + offset + text.length,
          { class: className },
        ),
      );
    }
  });

  return decorations;
}

const mermaidParser: Parser = ({ content, pos }) =>
  createRegexDecorations(content, pos, [
    {
      regex: /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|subgraph|end|participant|actor|as|loop|alt|else|opt|par|and|rect|note|over|title|section)\b/g,
      className: "hljs-keyword",
    },
    {
      regex: /(-->|---|--x|--o|==>|-.->|-\.-|:::|\|[^|\n]+\|)/g,
      className: "hljs-operator",
    },
    {
      regex: /(\[[^\]\n]+\]|\{[^}\n]+\}|\([^)\n]+\))/g,
      className: "hljs-string",
    },
  ]);

const SHELL_HIGHLIGHT_LANGUAGES = new Set([
  "bash",
  "shell",
  "sh",
  "zsh",
]);

const shellCommandParser: Parser = ({ content, pos }) =>
  createRegexCaptureDecorations(content, pos, [
    {
      regex: /(^|[;&|]\s*)([A-Za-z_][\w.-]*)(?=\s|$)/gm,
      captureGroup: 2,
      className: "hljs-title",
    },
    {
      regex: /(^|\s)(-{1,2}[\w-]+)(?=\s|=|$)/gm,
      captureGroup: 2,
      className: "hljs-params",
    },
    {
      regex: /(^|\s)([A-Za-z_][\w]*=)(?=\S)/gm,
      captureGroup: 2,
      className: "hljs-variable",
    },
  ]);

const codeBlockHighlightParser: Parser = (options) => {
  const language = normalizeHighlightLanguage(options.language);

  if (SKIP_HIGHLIGHT_LANGUAGES.has(language)) return [];
  if (language === "mermaid") return mermaidParser(options);

  // failedSet 里的语言（加载失败/vite 无法解析/别名缺失）→ 同步降级纯文本，不返回 Promise，
  // 彻底断掉「Promise → refresh → dispatch → 重算」的无限循环。
  if (failedLangsSet.has(language)) {
    return lowlightParser({ ...options, language: undefined }) as any;
  }

  // common 外语言（不在 loadedLanguagesSet 内）→ 加入 failedSet 同步降级纯文本。
  // 不返回 Promise，避免触发 highlightPlugin 的 refresh 重算循环。
  if (
    !AUTO_HIGHLIGHT_LANGUAGES.has(language) &&
    !loadedLanguagesSet.has(language) &&
    language !== "text"
  ) {
    failedLangsSet.add(language);
    return lowlightParser({ ...options, language: undefined }) as any;
  }

  try {
    const useLanguage =
      !AUTO_HIGHLIGHT_LANGUAGES.has(language) && loadedLanguagesSet.has(language)
        ? language
        : undefined;

    const decorations = lowlightParser({
      ...options,
      language: useLanguage,
    }) as any;

    if (SHELL_HIGHLIGHT_LANGUAGES.has(language)) {
      const shellDecorations = shellCommandParser(options);
      if (Array.isArray(shellDecorations) && shellDecorations.length > 0) {
        const baseDecorations = Array.isArray(decorations) ? decorations : [];
        return [...baseDecorations, ...shellDecorations];
      }
    }

    return decorations;
  } catch {
    return lowlightParser({ ...options, language: undefined }) as any;
  }
};

const codeBlockHighlightExtension = createExtension({
  key: "goose-code-block-highlighter",
  prosemirrorPlugins: [
    createHighlightPlugin({
      parser: codeBlockHighlightParser,
      nodeTypes: ["codeBlock"],
      languageExtractor: (node) => {
        const lang = node.attrs.language || node.attrs.props?.language;
        return normalizeHighlightLanguage(lang);
      },
    }),
  ],
});

const LATEX_SNIPPETS = [
  { label: "分数", code: "\\frac{a}{b}" },
  { label: "上标", code: "x^{n}" },
  { label: "下标", code: "x_{n}" },
  { label: "根号", code: "\\sqrt{x}" },
  { label: "求和", code: "\\sum_{i=1}^{n}" },
  { label: "积分", code: "\\int_{a}^{b}" },
  { label: "极限", code: "\\lim_{x \\to a}" },
  { label: "无穷大", code: "\\infty" },
  { label: "不等于", code: "\\neq" },
  { label: "小于等于", code: "\\leq" },
  { label: "大于等于", code: "\\geq" },
  { label: "箭头", code: "\\rightarrow" },
  { label: "向量", code: "\\vec{a}" },
  { label: "α", code: "\\alpha" },
  { label: "β", code: "\\beta" },
  { label: "π", code: "\\pi" },
  { label: "矩阵", code: "\\begin{matrix} a & b \\\\ c & d \\end{matrix}" },
  { label: "n次根", code: "\\sqrt[n]{x}" },
];

type CodePreviewMode = "code" | "preview";

function downloadTextFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function CodeBlockPreviewLightbox({
  open,
  language,
  value,
  onClose,
}: {
  open: boolean;
  language: string;
  value: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const title = language === "math" ? "公式预览" : "Mermaid";

  return createPortal(
    <div
      className="goose-code-preview-lightbox"
      contentEditable={false}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="goose-code-preview-lightbox-panel">
        <div className="goose-code-preview-lightbox-header">
          <div className="goose-code-preview-lightbox-title">{title}</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="关闭预览"
            onClick={onClose}
            className="goose-code-preview-lightbox-close h-7 w-7 p-0"
          >
            <LucideIcons.X className="h-4 w-4" />
          </Button>
        </div>
        <div className="goose-code-preview-lightbox-body">
          {language === "math" ? (
            <MathView value={value} displayMode={true} />
          ) : (
            <MermaidView value={value} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CodeBlockComponent({
  block,
  contentRef,
  editor,
}: {
  block: any;
  contentRef: any;
  editor: any;
}) {
  const { onDefaultCodeBlockWrapChange, theme } = useEditorSettings();
  const language = (block.props.language as string) || "text";
  const wrap = block.props.wrap === true;
  const collapsed = block.props.collapsed === true;
  const summary = typeof block.props.summary === "string" ? block.props.summary : "";
  const isEditable = editor.isEditable;

  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const summaryInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [showLatexHint, setShowLatexHint] = useState(false);
  const [previewMode, setPreviewMode] = useState<CodePreviewMode>("code");
  const [isPreviewLightboxOpen, setIsPreviewLightboxOpen] = useState(false);

  const getCodeContent = useCallback(() => {
    let text = "";
    const content = block.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((c: any) => c?.text ?? "").join("");
    }
    // Walk inline content via DOM
    const el = contentRef.current;
    if (el) return el.textContent || "";
    return "";
  }, [block.content, contentRef]);

  const handleLanguageChange = useCallback(
    (lang: string) => {
      editor.updateBlock(block.id, { props: { language: lang } });
    },
    [editor, block.id],
  );

  const handleWrapChange = useCallback(
    (w: boolean) => {
      onDefaultCodeBlockWrapChange(w);
      editor.updateBlock(block.id, { props: { wrap: w } });
    },
    [editor, block.id, onDefaultCodeBlockWrapChange],
  );

  const normalizeSummary = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

  const handleSummaryCommit = useCallback(() => {
    const next = normalizeSummary(summaryDraft);
    if (next !== summary) {
      editor.updateBlock(block.id, { props: { summary: next } });
    }
    setSummaryDraft(next);
    setIsEditingSummary(false);
  }, [summaryDraft, summary, editor, block.id]);

  const handleCollapsedChange = useCallback(() => {
    editor.updateBlock(block.id, { props: { collapsed: !collapsed } });
  }, [editor, block.id, collapsed]);

  const handleFormat = useCallback(
    (formatted: string) => {
      // BlockNote: update block content by replacing all text
      const currentContent = block.content;
      if (Array.isArray(currentContent) && currentContent.length > 0) {
        editor.updateBlock(block.id, {
          content: [{ type: "text", text: formatted, styles: {} }],
        });
      }
    },
    [editor, block.id, block.content],
  );

  const insertTextAtCursor = useCallback((text: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLPreElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const text = e.clipboardData.getData("text/plain");
      if (text) {
        insertTextAtCursor(text.replace(/\r\n/g, "\n"));
      }
    },
    [insertTextAtCursor],
  );

  const handleDownloadPreview = useCallback(async () => {
    const text = getCodeContent().trim();
    if (!text || typeof document === "undefined") return;

    if (language === "mermaid") {
      try {
        const isDark =
          theme === "dark" ||
          (theme === "system" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);
        const svg = await renderMermaidSvgForExport(text, isDark ? "dark" : "light");
        downloadTextFile(svg, "mermaid.svg", "image/svg+xml;charset=utf-8");
        return;
      } catch {}
    }

    downloadTextFile(text, language === "math" ? "formula.tex" : "code.txt", "text/plain;charset=utf-8");
  }, [getCodeContent, language, theme]);

  const textContent = getCodeContent();
  const lineCount = textContent.split("\n").length;
  // 速记小窗精简构建（__GOOSE_LITE__）不渲染 math/mermaid 预览——退化为纯代码块
  // （源码可见、带行号），以甩掉 katex / mermaid 重型依赖。主应用恒为 false，行为不变。
  const isMathOrMermaid =
    !__GOOSE_LITE__ && (language === "math" || language === "mermaid");
  const canPreview = isMathOrMermaid && textContent.trim().length > 0;
  const shouldShowPreview = canPreview && previewMode === "preview";
  const shouldShowSource = !isMathOrMermaid || previewMode === "code" || !canPreview;
  const showLineNumbers = !isMathOrMermaid && !wrap;
  const visualTitle = language === "math" ? "Math" : "Mermaid";

  useEffect(() => {
    if (!isEditingSummary) return;
    const timer = setTimeout(() => {
      summaryInputRef.current?.focus();
      summaryInputRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [isEditingSummary]);

  useEffect(() => {
    if (!isMathOrMermaid) {
      setPreviewMode("code");
      setIsPreviewLightboxOpen(false);
      return;
    }
    if (!canPreview) {
      setPreviewMode("code");
      setIsPreviewLightboxOpen(false);
      return;
    }
    setPreviewMode((current) => (current === "code" ? "preview" : current));
  }, [isMathOrMermaid, canPreview]);

  return (
    <div
      className="goose-code-block-node relative"
      data-collapsed={collapsed ? "true" : "false"}
      data-visual-preview={isMathOrMermaid ? "true" : undefined}
    >
      {/* Toolbar row */}
      <div className="goose-code-toolbar-row" contentEditable={false}>
        <div className="goose-code-toolbar-left flex items-center gap-0.5 min-w-0 flex-1">
          {isMathOrMermaid ? (
            <div className="goose-code-visual-title">{visualTitle}</div>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={collapsed ? "展开代码块" : "折叠代码块"}
                onClick={handleCollapsedChange}
                className={cn(
                  "h-6 w-6 p-0 shrink-0 rounded-md transition-transform",
                  collapsed && "-rotate-90",
                )}
              >
                <LucideIcons.ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Input
                ref={summaryInputRef}
                value={isEditingSummary ? summaryDraft : summary}
                readOnly={!isEditable || !isEditingSummary}
                placeholder="添加代码说明"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (!isEditable) return;
                  if (!isEditingSummary) setSummaryDraft(summary);
                }}
                onFocus={() => {
                  if (!isEditable) return;
                  if (!isEditingSummary) {
                    setSummaryDraft(summary);
                    setIsEditingSummary(true);
                  }
                }}
                onChange={(e) => {
                  if (!isEditingSummary) return;
                  setSummaryDraft(e.target.value);
                }}
                onBlur={() => {
                  if (!isEditingSummary) return;
                  handleSummaryCommit();
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (isEditingSummary) handleSummaryCommit();
                    summaryInputRef.current?.blur();
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSummaryDraft(summary);
                    setIsEditingSummary(false);
                    summaryInputRef.current?.blur();
                    return;
                  }
                  e.stopPropagation();
                }}
                className={cn(
                  "h-6 w-full min-w-0 rounded-md border-0 bg-transparent px-1.5 text-xs shadow-none",
                  "placeholder:text-muted-foreground/50",
                  "focus-visible:ring-0 focus-visible:ring-offset-0",
                  !isEditingSummary && !summary && "opacity-50",
                  !isEditingSummary && summary && "opacity-70",
                )}
              />
            </>
          )}
        </div>
        <CodeBlockToolbar
          language={language}
          onLanguageChange={handleLanguageChange}
          getCodeContent={getCodeContent}
          onFormat={__GOOSE_LITE__ ? undefined : handleFormat}
          wrap={wrap}
          onWrapChange={handleWrapChange}
          editable={isEditable}
          previewMode={previewMode}
          onPreviewModeChange={setPreviewMode}
          onOpenPreview={() => {
            if (canPreview) setIsPreviewLightboxOpen(true);
          }}
          onDownloadPreview={handleDownloadPreview}
          canPreview={canPreview}
        />
      </div>

      {/* Code content */}
      {(!collapsed || isMathOrMermaid) && (
        <div className="goose-code-content-wrapper">
          {showLineNumbers && shouldShowSource && (
            <div className="goose-code-line-numbers" contentEditable={false}>
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <pre
            className={cn(
              "goose-code-pre",
              wrap && "goose-code-pre-wrap",
              isMathOrMermaid && "goose-code-pre-source",
              !shouldShowSource && "goose-code-pre-hidden",
            )}
            aria-hidden={!shouldShowSource}
            onPaste={handlePaste}
          >
            <code
              ref={contentRef}
              className="goose-code-content hljs"
              style={wrap ? { whiteSpace: "break-spaces", wordBreak: "break-word", overflowWrap: "anywhere" } : undefined}
            />
          </pre>
          {shouldShowPreview && (
            <div
              ref={previewRef}
              contentEditable={false}
              className="goose-code-preview select-none cursor-pointer bg-transparent"
              onDoubleClick={() => setIsPreviewLightboxOpen(true)}
            >
              {language === "math" && <MathView value={textContent} displayMode={true} />}
              {language === "mermaid" && <MermaidView value={textContent} />}
            </div>
          )}
        </div>
      )}

      <CodeBlockPreviewLightbox
        open={isPreviewLightboxOpen}
        language={language}
        value={textContent}
        onClose={() => setIsPreviewLightboxOpen(false)}
      />

      {/* LaTeX hint panel */}
      {!collapsed && language === "math" && isEditable && (
        <div className="absolute bottom-2 right-2 z-20">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLatexHint(!showLatexHint)}
            className={cn(
              "h-6 w-6 p-0 rounded-md",
              "border border-[var(--goose-block-subtle-border)] bg-[var(--goose-block-subtle-bg)]",
              showLatexHint &&
                "border-[var(--goose-callout-accent)] bg-[var(--goose-interactive-selected)] text-primary",
            )}
          >
            <LucideIcons.HelpCircle className="h-3.5 w-3.5" />
          </Button>
          {showLatexHint && (
            <div className="absolute bottom-8 right-0 z-30 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-3 shadow-lg">
              <div className="flex items-center justify-between border-b pb-2 mb-2">
                <span className="text-xs font-semibold">LaTeX 语法参考</span>
                <button
                  type="button"
                  onClick={() => setShowLatexHint(false)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                >
                  <LucideIcons.X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                <div className="grid grid-cols-2 gap-1.5">
                  {LATEX_SNIPPETS.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setShowLatexHint(false)}
                      className="flex flex-col items-start gap-1 rounded-md border border-[var(--goose-block-subtle-border)] bg-[var(--goose-block-subtle-bg)] px-2 py-1.5 text-left hover:bg-[var(--goose-interactive-hover)]"
                    >
                      <span className="text-[11px] font-medium text-muted-foreground">{s.label}</span>
                      <code className="text-[11px] font-mono text-foreground break-all">{s.code}</code>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const codeBlockSpec = createReactBlockSpec(
  {
    type: "codeBlock",
    propSchema: {
      ...defaultProps,
      language: { default: "text" },
      wrap: { default: false },
      collapsed: { default: false },
      summary: { default: "" },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef, editor }) => (
      <CodeBlockComponent block={block} contentRef={contentRef} editor={editor} />
    ),
    // 粘贴/导入识别 <pre><code> → 还原为代码块(否则自定义 spec 覆盖了默认 codeBlock 的
    // 解析规则,从网页/富文本复制的代码块会因无 parse 而降级成普通段落)。
    // content="inline" 时,框架用匹配元素(<pre>)的文本内容作为代码内容,parse 只需回传 props。
    parse: (element: HTMLElement) => {
      const tag = element.tagName?.toUpperCase();
      // 标准结构 <pre>...</pre>;裸 <code class="language-x"> 由其外层 <pre> 处理,
      // 单独的 inline <code> 不在此拦截(交给默认 inline code 样式)。
      if (tag !== "PRE") return undefined;
      const codeEl = element.querySelector("code");
      const langSource = codeEl ?? element;
      // 语言来源:class="language-xxx" / "lang-xxx" / hljs 的 "language-xxx" / data-language。
      let language =
        langSource.getAttribute("data-language") ||
        langSource.getAttribute("data-lang") ||
        "";
      if (!language) {
        const cls = langSource.getAttribute("class") || "";
        const m = cls.match(/(?:language|lang)-([\w+#-]+)/i);
        if (m) language = m[1];
      }
      const normalized = language
        ? LANGUAGE_ALIASES[language.trim().toLowerCase()] ?? language.trim().toLowerCase()
        : "text";
      return { language: normalized };
    },
    toExternalHTML: ({ block, contentRef }) => {
      const lang = (block.props?.language || "text").trim();
      return (
        <pre>
          <code ref={contentRef} className={lang ? `language-${lang}` : undefined} />
        </pre>
      );
    },
  },
  [codeBlockHighlightExtension],
)();
