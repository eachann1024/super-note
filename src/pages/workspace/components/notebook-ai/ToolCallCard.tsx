/**
 * 工具调用折叠卡片 — 运行中/完成/错误三态，Lucide 1.75 描边
 */
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TOOL_LABELS: Record<string, string> = {
  "tool-listNotebooks": "列出记事本",
  "tool-listPages": "列出页面",
  "tool-searchNotes": "搜索笔记",
  "tool-readPage": "读取页面",
  "tool-createPage": "创建页面",
  "tool-updatePage": "更新页面",
  "tool-replaceInPage": "批量替换",
  "tool-showTable": "生成表格",
  "tool-showChart": "生成图表",
  "tool-showDiagram": "生成图形",
  "tool-showSvg": "生成 SVG",
};

interface ToolCallCardProps {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  isMessageStreaming?: boolean;
}

function truncate(s: string, max = 200) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function renderValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return truncate(v);
  return truncate(JSON.stringify(v, null, 2));
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getToolSummary(
  toolName: string,
  state: string,
  input: unknown,
  output: unknown,
  isMessageStreaming?: boolean,
  errorText?: string,
) {
  const inputObject = readObject(input);
  const query =
    toolName === "tool-searchNotes" && typeof inputObject?.query === "string"
      ? inputObject.query
      : "";
  const isPendingInput =
    state === "call" ||
    state === "partial-call" ||
    state === "input-streaming" ||
    state === "input-available";
  const isStalled = isPendingInput && !isMessageStreaming;
  const isRunning = isPendingInput && !isStalled;
  const isError = state === "output-error" || !!errorText;
  const isDone =
    state === "result" ||
    state === "output-available" ||
    (!isPendingInput && !isError && output !== undefined);

  if (isError) return { isRunning, isError, isDone, status: "失败" };
  if (isStalled) return { isRunning, isError, isDone, status: "未完成" };
  if (isRunning) {
    return {
      isRunning,
      isError,
      isDone,
      status: query ? `搜索“${truncate(query, 18)}”` : "执行中",
    };
  }

  if (toolName === "tool-searchNotes" && Array.isArray(output)) {
    return {
      isRunning,
      isError,
      isDone,
      status: output.length > 0 ? `找到 ${output.length} 条` : "无结果",
    };
  }

  if (toolName === "tool-readPage" && isDone) {
    const page = readObject(output);
    return {
      isRunning,
      isError,
      isDone,
      status: page?.error ? "未读取" : "已读取",
    };
  }

  return { isRunning, isError, isDone, status: isDone ? "完成" : "等待中" };
}

function renderSearchOutput(output: unknown) {
  if (!Array.isArray(output)) return null;
  if (output.length === 0) {
    return <p className="text-muted-foreground">没有找到匹配笔记。</p>;
  }

  return (
    <div className="space-y-1">
      {output.slice(0, 5).map((item, index) => {
        const result = readObject(item);
        const title = typeof result?.title === "string" ? result.title : `结果 ${index + 1}`;
        const snippet = typeof result?.snippet === "string" ? result.snippet : "";
        return (
          <div key={`${title}-${index}`} className="space-y-0.5">
            <div className="font-medium text-foreground">{title}</div>
            {snippet ? (
              <div className="line-clamp-2 text-muted-foreground">{snippet}</div>
            ) : null}
          </div>
        );
      })}
      {output.length > 5 ? (
        <div className="text-muted-foreground">还有 {output.length - 5} 条结果未展开显示。</div>
      ) : null}
    </div>
  );
}

function renderOutput(toolName: string, output: unknown) {
  if (toolName === "tool-searchNotes") {
    const searchOutput = renderSearchOutput(output);
    if (searchOutput) return searchOutput;
  }

  return (
    <pre className="whitespace-pre-wrap break-all text-muted-foreground font-mono text-[11px]">
      {renderValue(output)}
    </pre>
  );
}

export function ToolCallCard({
  toolName,
  state,
  input,
  output,
  errorText,
  isMessageStreaming,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const label = TOOL_LABELS[toolName] ?? toolName.replace(/^tool-/, "");
  const { isRunning, isError, isDone, status } = getToolSummary(
    toolName,
    state,
    input,
    output,
    isMessageStreaming,
    errorText,
  );

  return (
    <div
      className={cn(
        "my-1 rounded-[8px] border text-xs",
        "border-border bg-[var(--goose-interactive-hover)]",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {isRunning ? (
          <Loader2
            className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
            strokeWidth={1.75}
          />
        ) : isError ? (
          <AlertCircle
            className="h-3.5 w-3.5 shrink-0 text-destructive"
            strokeWidth={1.75}
          />
        ) : (
          <CheckCircle2
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {label}
        </span>
        <span className="shrink-0 text-muted-foreground">{status}</span>
        {expanded ? (
          <ChevronDown
            className="h-3 w-3 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        ) : (
          <ChevronRight
            className="h-3 w-3 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          <div>
            <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              状态
            </div>
            <p className={cn("text-muted-foreground", isError && "text-destructive")}>
              {isRunning
                ? "工具已收到参数，正在等待返回结果。"
                : isError
                  ? "工具执行失败。"
                  : isDone
                    ? "工具执行完成。"
                    : "工具没有拿到返回结果，可能是本次生成已中断。"}
            </p>
          </div>
          {input !== undefined && (
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                参数
              </div>
              <pre className="whitespace-pre-wrap break-all text-muted-foreground font-mono text-[11px]">
                {renderValue(input)}
              </pre>
            </div>
          )}
          {isError && (
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wide text-destructive">
                错误
              </div>
              <pre className="whitespace-pre-wrap break-all text-destructive font-mono text-[11px]">
                {errorText}
              </pre>
            </div>
          )}
          {isDone && (
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                结果摘要
              </div>
              {output !== undefined ? (
                renderOutput(toolName, output)
              ) : (
                <p className="text-muted-foreground">工具已完成，未返回额外内容。</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
