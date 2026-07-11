/**
 * Notebook AI composer — wraps the shared @-aware AI composer input.
 */
import { useCallback, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AiComposerInput,
  type AiComposerInputHandle,
} from "@/components/editor/ai/composer/AiComposerInput";
import type {
  AiComposerPayload,
  AiReferenceSuggestionItem,
} from "@/components/editor/ai/composer/referenceLookup";

interface ComposerProps {
  onSend: (payload: AiComposerPayload) => boolean | void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPages?: (query: string) => AiReferenceSuggestionItem[];
  onEscape?: () => void;
}

export function Composer({
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder = "向 AI 提问，输入 @ 引用当前笔记本页面…",
  searchPages,
  onEscape,
}: ComposerProps) {
  const inputRef = useRef<AiComposerInputHandle>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [autoFocusToken, setAutoFocusToken] = useState(0);

  const handleEscape = useCallback(() => {
    onEscape?.();
  }, [onEscape]);

  const handleSubmit = useCallback(() => {
    if (disabled || isStreaming || isEmpty) return;
    const payload = inputRef.current?.getPayload();
    if (!payload?.promptText.trim()) return;

    const accepted = onSend(payload);
    if (accepted === false) return;

    inputRef.current?.clear();
    setIsEmpty(true);
    setAutoFocusToken((token) => token + 1);
  }, [disabled, isStreaming, isEmpty, onSend]);

  const canSend = !isStreaming && !disabled && !isEmpty;

  return (
    <div className="shrink-0 px-3 py-2.5">
      <div
        className={cn(
          "flex items-end gap-2 rounded-[10px] border border-border bg-background px-3 py-2",
          "focus-within:border-border",
          "transition-colors duration-150",
        )}
      >
        <AiComposerInput
          ref={inputRef}
          placeholder={placeholder}
          autoFocusToken={autoFocusToken}
          onSubmit={handleSubmit}
          onEscape={handleEscape}
          onIsEmptyChange={setIsEmpty}
          searchPages={searchPages}
          variant="panel"
          disabled={disabled || isStreaming}
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className={cn(
              "mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]",
              "bg-[var(--goose-interactive-selected)] text-muted-foreground hover:text-foreground",
              "transition-colors duration-150",
            )}
            aria-label="停止生成"
            title="停止生成"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSend}
            className={cn(
              "mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]",
              "transition-colors duration-150",
              canSend
                ? "bg-[var(--goose-interactive-selected)] text-muted-foreground hover:text-foreground"
                : "cursor-not-allowed text-muted-foreground opacity-50",
            )}
            aria-label="发送消息"
            title="发送消息"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  );
}
