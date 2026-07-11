/**
 * 消息列表组件 — Streamdown 渲染 text part，自动吸底，用户上滚暂停
 */
import { Fragment, useEffect, useRef, useCallback } from "react";
import type { ComponentProps, RefObject } from "react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { Check, MessageSquareText, Sparkles } from "lucide-react";
import { ToolProgressCard } from "./ToolProgressCard";
import { TableCard } from "./TableCard";
import { ChartCard } from "./ChartCard";
import { DiagramCard } from "./DiagramCard";
import { SvgArtifactCard } from "./SvgArtifactCard";
import { shouldShowToolProgress, type ToolDisplayPart } from "./toolProgressVisibility";
import type { EditorRef } from "@/components/editor/core/Editor";
import { isNotebookAiToolPart } from "@/lib/notebook-ai/messageUtils";
import type { NotebookAiMessage } from "@/lib/notebook-ai/types";

const ANIMATE_OPTIONS = {
  animation: "blurIn" as const,
  duration: 250,
  sep: "word" as const,
};

/** 任务列表的原生 checkbox 替换为自绘勾选框（样式见 notebook-ai.css） */
function MdInput({
  node,
  ...props
}: ComponentProps<"input"> & { node?: unknown }) {
  void node;
  if (props.type === "checkbox") {
    return (
      <span
        className="ai-md-checkbox"
        data-checked={props.checked ? "true" : "false"}
      >
        {props.checked ? <Check strokeWidth={2.5} /> : null}
      </span>
    );
  }
  return <input {...props} />;
}

const MD_COMPONENTS = { input: MdInput };

interface ChatMessagesProps {
  messages: NotebookAiMessage[];
  /** 正在流式输出的消息 id（最后一条 assistant msg id）*/
  streamingMessageId?: string;
  editorRef?: RefObject<EditorRef | null>;
}

const INPUT_ONLY_STATES = new Set([
  "call",
  "partial-call",
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

function getTextPartText(message: NotebookAiMessage) {
  const textPart = message.parts?.find((p) => p.type === "text");
  return textPart && "text" in textPart ? (textPart as { text: string }).text : "";
}

function getUserDisplayText(message: NotebookAiMessage) {
  const metadataText = message.metadata?.displayText?.trim();
  if (metadataText) return metadataText;

  const rawText = getTextPartText(message).trim();
  const hiddenContextStart = rawText.indexOf("\n\n本轮笔记上下文：");
  if (rawText.startsWith("用户输入：") && hiddenContextStart > -1) {
    return rawText.slice("用户输入：".length, hiddenContextStart).trim();
  }
  if (rawText.startsWith("用户输入：")) {
    return rawText.slice("用户输入：".length).trim();
  }
  return rawText;
}

function shouldShowToolPart(part: ToolDisplayPart, isMessageStreaming: boolean) {
  const state = part.state ?? "";
  const hasTerminalPayload =
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied" ||
    part.output !== undefined ||
    Boolean(part.errorText);

  return isMessageStreaming || !INPUT_ONLY_STATES.has(state) || hasTerminalPayload;
}

function renderToolVisual(
  part: ToolDisplayPart,
  key: string | number,
  editorRef: RefObject<EditorRef | null> | undefined,
) {
  if (part.type === "tool-showTable" && part.state === "output-available" && part.output) {
    const tableData = part.output as {
      title?: string;
      columns: string[];
      rows: string[][];
    };
    return (
      <TableCard
        key={key}
        title={tableData.title}
        columns={tableData.columns}
        rows={tableData.rows}
      />
    );
  }

  if (part.type === "tool-showChart" && part.state === "output-available" && part.output) {
    const chartData = part.output as {
      type: "bar" | "line" | "pie";
      title?: string;
      categories?: string[];
      series: Array<{ name: string; data: number[] }>;
    };
    return (
      <ChartCard
        key={key}
        type={chartData.type}
        title={chartData.title}
        categories={chartData.categories}
        series={chartData.series}
      />
    );
  }

  if (part.type === "tool-showDiagram" && part.state === "output-available" && part.output) {
    const diagramData = part.output as {
      title?: string;
      language: "mermaid";
      source: string;
    };
    return (
      <DiagramCard
        key={key}
        title={diagramData.title}
        source={diagramData.source}
        editorRef={editorRef}
      />
    );
  }

  if (part.type === "tool-showSvg" && part.state === "output-available" && part.output) {
    const svgData = part.output as {
      title?: string;
      svg: string;
    };
    return (
      <SvgArtifactCard
        key={key}
        title={svgData.title}
        svg={svgData.svg}
        editorRef={editorRef}
      />
    );
  }

  return null;
}

export function ChatMessages({
  messages,
  streamingMessageId,
  editorRef,
}: ChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolled = useRef(false);
  const lastScrollTop = useRef(0);

  const scrollToBottom = useCallback((force = false) => {
    const el = containerRef.current;
    if (!el) return;
    if (force || !isUserScrolled.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // 检测用户手动上滚
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const diff = el.scrollTop - lastScrollTop.current;
      lastScrollTop.current = el.scrollTop;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (atBottom) {
        isUserScrolled.current = false;
      } else if (diff < 0) {
        isUserScrolled.current = true;
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // 新消息到来时吸底
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 流式结束后强制吸底
  useEffect(() => {
    if (!streamingMessageId) {
      isUserScrolled.current = false;
      scrollToBottom(true);
    }
  }, [streamingMessageId, scrollToBottom]);

  if (messages.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-y-auto px-5"
      >
        <div className="flex max-w-[260px] flex-col items-center gap-3 text-center">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-[12px] bg-[var(--goose-interactive-hover)] text-muted-foreground">
            <MessageSquareText className="h-5 w-5" strokeWidth={1.75} />
            <Sparkles
              className="absolute -right-1 -top-1 h-3.5 w-3.5 text-muted-foreground"
              strokeWidth={1.75}
            />
          </div>
          <p className="text-sm font-medium text-foreground">开始和 AI 对话</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            让它帮你整理、搜索、创作笔记。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="notebook-ai-messages flex-1 overflow-y-auto px-3 py-3 space-y-3 [scrollbar-width:thin]"
    >
      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const isStreaming = streamingMessageId === msg.id;

        if (isUser) {
          const text = getUserDisplayText(msg);
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="notebook-ai-message-text max-w-[85%] rounded-[12px] rounded-tr-[4px] bg-[var(--goose-interactive-selected)] px-3 py-2 text-sm text-foreground leading-relaxed">
                {text}
              </div>
            </div>
          );
        }

        // assistant message
        const toolParts = (msg.parts ?? [])
          .filter(isNotebookAiToolPart)
          .filter((part) => shouldShowToolPart(part, isStreaming));
        let renderedToolProgress = false;
        const showToolProgress = shouldShowToolProgress(toolParts, isStreaming);

        return (
          <div key={msg.id} className="space-y-1">
            {msg.parts?.map((part, pi) => {
              const partType = part.type;

              if (partType === "text") {
                const textContent = (part as { text: string }).text;
                return (
                  <div key={pi} className="ai-md notebook-ai-message-text text-sm text-foreground">
                    <Streamdown
                      className="space-y-2"
                      components={MD_COMPONENTS}
                      isAnimating={isStreaming}
                      animated={ANIMATE_OPTIONS}
                      plugins={{ cjk }}
                      parseIncompleteMarkdown={isStreaming}
                    >
                      {textContent}
                    </Streamdown>
                  </div>
                );
              }

              if (partType === "reasoning") {
                return null;
              }

              // tool parts
              if (isNotebookAiToolPart(part)) {
                const toolPart = part as ToolDisplayPart;
                if (!shouldShowToolPart(toolPart, isStreaming)) return null;

                const visual = renderToolVisual(toolPart, `visual-${pi}`, editorRef);
                if (showToolProgress && !renderedToolProgress) {
                  renderedToolProgress = true;
                  return (
                    <Fragment key={pi}>
                      <ToolProgressCard
                        parts={toolParts}
                        isMessageStreaming={isStreaming}
                      />
                      {visual}
                    </Fragment>
                  );
                }

                return visual;
              }

              return null;
            })}
          </div>
        );
      })}
    </div>
  );
}
