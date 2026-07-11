import { useMemo, useState } from "react";
import {
  Check,
  Clock3,
  History as HistoryIcon,
  MessageSquareText,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NotebookAiMessage } from "@/lib/notebook-ai/types";
import { useNotebookAiChats } from "@/stores/useNotebookAiChats";

export interface ConversationHistoryPopoverProps {
  notebookId: string;
  onSelectConversation: (conversationId: string) => void;
  disabled?: boolean;
}

function getMessageText(message: NotebookAiMessage) {
  const textPart = message.parts?.find((part) => part.type === "text");
  return textPart && "text" in textPart && typeof textPart.text === "string"
    ? textPart.text
    : "";
}

function getUserDisplayText(message: NotebookAiMessage) {
  const displayText = message.metadata?.displayText?.trim();
  if (displayText) return displayText;

  const rawText = getMessageText(message).trim();
  const hiddenContextStart = rawText.indexOf("\n\n本轮笔记上下文：");
  if (rawText.startsWith("用户输入：") && hiddenContextStart > -1) {
    return rawText.slice("用户输入：".length, hiddenContextStart).trim();
  }
  return rawText.startsWith("用户输入：")
    ? rawText.slice("用户输入：".length).trim()
    : rawText;
}

function getConversationSummary(messages: NotebookAiMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  return firstUserMessage
    ? getUserDisplayText(firstUserMessage) || "新会话"
    : "新会话";
}

function formatConversationTime(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return date.toLocaleDateString("zh-CN", {
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ConversationHistoryPopover({
  notebookId,
  onSelectConversation,
  disabled = false,
}: ConversationHistoryPopoverProps) {
  const [open, setOpen] = useState(false);
  const notebookChatState = useNotebookAiChats(
    (state) => state.chats[notebookId],
  );
  const activeConversationId = notebookChatState?.activeConversationId ?? null;
  const conversations = useMemo(
    () =>
      Object.values(notebookChatState?.conversations ?? {})
        .filter((conversation) => conversation.messages.length > 0)
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [notebookChatState],
  );

  const selectConversation = (conversationId: string) => {
    if (conversationId !== activeConversationId) {
      onSelectConversation(conversationId);
    }
    setOpen(false);
  };

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label="历史会话"
          title="历史会话"
          disabled={disabled}
        >
          <HistoryIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-0">
        <div className="border-b border-border/70 px-3 py-2.5">
          <div className="text-sm font-medium text-foreground">历史会话</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            切换当前笔记本的 AI 会话
          </div>
        </div>

        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-muted-foreground">
            <MessageSquareText className="h-5 w-5" strokeWidth={1.5} />
            <span className="text-xs">暂无历史会话</span>
          </div>
        ) : (
          <ScrollArea
            className="p-1.5"
            style={{ height: Math.min(conversations.length * 58 + 12, 300) }}
          >
            <div className="space-y-0.5 pr-1">
              {conversations.map((conversation) => {
                const isActive = conversation.id === activeConversationId;
                const summary = getConversationSummary(conversation.messages);

                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => selectConversation(conversation.id)}
                    className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--goose-interactive-hover)]"
                    aria-current={isActive ? "true" : undefined}
                    title={summary}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">
                        {summary}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock3 className="h-3 w-3" strokeWidth={1.75} />
                        <span>
                          {formatConversationTime(conversation.updatedAt)}
                        </span>
                      </div>
                    </div>
                    {isActive ? (
                      <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-foreground">
                        <Check className="h-3 w-3" strokeWidth={2} />
                        当前
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
