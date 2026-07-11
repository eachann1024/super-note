/**
 * NotebookAiPanel — AI 聊天面板（右侧并排，可拖宽）
 *
 * - useChat（@ai-sdk/react）+ DirectChatTransport proxy
 * - 会话按 notebookId 隔离持久化（useNotebookAiChats）
 * - 每轮发送绑定当前活动页签 pageId，避免新建/切换页面影响当前请求
 * - 流式写入页面：handleStreamingWritePart + cleanupWriterSession
 */
import {
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { useChat } from "@ai-sdk/react";
import { X, Plus, Bot, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import type { RefObject } from "react";
import type { EditorRef } from "@/components/editor/core/Editor";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { useNotebookAiChats } from "@/stores/useNotebookAiChats";
import { buildTransport } from "@/lib/notebook-ai/transport";
import {
  handleStreamingWritePart,
  cleanupWriterSession,
  type StreamingWritePart,
} from "@/lib/notebook-ai/liveWriter";
import { buildLanguageModel } from "@/lib/notebook-ai/model";
import {
  buildNotebookAiUserMessage,
  getCurrentNotebookAiPageId,
  getNotebookAiReferenceSuggestions,
} from "@/lib/notebook-ai/context";
import { sanitizeNotebookAiMessages } from "@/lib/notebook-ai/messageUtils";
import {
  applyBlockTypeTransformToEditor,
  createPageBodyBlockTypeTransformSnapshot,
  hasWholePageBlockTypeTransformScope,
  isBlockTypeTransformSelectionSnapshot,
  planBlockTypeTransform,
  resolveBlockTypeTransformIntent,
  type BlockTypeTransformBlock,
  type BlockTypeTransformSelectionSnapshot,
} from "@/lib/ai-write";
import { ChatMessages } from "./ChatMessages";
import { Composer } from "./Composer";
import { usePanelWidth } from "./usePanelWidth";
import { ConversationHistoryPopover } from "./ConversationHistoryPopover";
import type { NotebookAiPanelSelectionCapture } from "./useNotebookAiPanel";
import type { AiComposerPayload } from "@/components/editor/ai/composer/referenceLookup";
import type { ChatTransport } from "ai";
import type { NotebookAiMessage } from "@/lib/notebook-ai/types";
import type { JSONContent, Page } from "@/types";

interface NotebookAiPanelProps {
  notebookId: string;
  onClose: () => void;
  editorRef?: RefObject<EditorRef | null>;
  capturedSelection?: NotebookAiPanelSelectionCapture | null;
  onConsumeCapturedSelection?: () => void;
}

const NOTEBOOK_AI_PLACEHOLDER_HINTS = [
  "向 AI 提问，输入 @ 引用当前笔记本页面…",
  "让 AI 根据当前笔记生成一张趋势图…",
  "让 AI 画一个流程图或架构图…",
  "让 AI 生成 SVG 图标或矢量示意图…",
  "试试：总结 @页面，并画出要点关系图…",
];

function formatChatError(error: Error): string {
  const message = error.message?.trim();
  return message || "本轮请求失败，请稍后重试。";
}

function createChatMessageId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getPageBlocks(content: unknown): BlockTypeTransformBlock[] {
  if (Array.isArray(content)) {
    return content as BlockTypeTransformBlock[];
  }
  if (
    content &&
    typeof content === "object" &&
    Array.isArray((content as { content?: unknown }).content)
  ) {
    return (content as { content: BlockTypeTransformBlock[] }).content;
  }
  return [];
}

function getTransformTargetError(
  page: Page | undefined,
  notebookId: string,
): string | null {
  if (!page) return "当前页面不存在，未转换待办事项。";
  if (page.workspaceId !== notebookId) {
    return "当前页面不属于这个记事本，未转换待办事项。";
  }
  if (page.isFolder) return "文件夹不能转换为待办事项。";
  if (page.trashedAt) return "回收站页面不能被修改。";
  if (page.isLocked) return "页面已锁定，未转换待办事项。";
  if (page.localFilePath && page.localReadState === "error") {
    return "本地页面读取失败，未转换待办事项。";
  }
  return null;
}

export function NotebookAiPanel({
  notebookId,
  onClose,
  editorRef,
  capturedSelection,
  onConsumeCapturedSelection,
}: NotebookAiPanelProps) {
  const { notebooks } = useNotebooks();
  const notebook = notebooks[notebookId];
  const notebookName = notebook?.name ?? "AI 助手";

  const { width, onDragHandleMouseDown } = usePanelWidth();
  const requestCurrentPageIdRef = useRef<string | null>(null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isApplyingTransform, setIsApplyingTransform] = useState(false);
  const [conversationId, setConversationId] = useState(() => {
    const chats = useNotebookAiChats.getState();
    return (
      chats.getActiveConversationId(notebookId) ??
      chats.createConversation(notebookId)
    );
  });

  // 检查模型是否可用（用于引导文案）
  const modelCheck = buildLanguageModel();

  // 持久化消息
  const persistedMessages = useMemo(
    () =>
      useNotebookAiChats
        .getState()
        .getConversationMessages(notebookId, conversationId),
    [notebookId, conversationId],
  );

  // useChat 只在 chat id 改变时重建 Chat；transport 必须保持稳定，
  // 并在真正发送时再绑定本轮最新的页签上下文。
  const transport = useMemo<ChatTransport<NotebookAiMessage>>(
    () => ({
      async sendMessages(options) {
        const currentPageId =
          requestCurrentPageIdRef.current ??
          getCurrentNotebookAiPageId(notebookId);
        const result = buildTransport(notebookId, currentPageId);
        if (!result.ok) {
          throw new Error(result.reason);
        }

        return result.transport.sendMessages({
          ...options,
          messages: sanitizeNotebookAiMessages(options.messages),
        });
      },
      async reconnectToStream(options) {
        const currentPageId =
          requestCurrentPageIdRef.current ??
          getCurrentNotebookAiPageId(notebookId);
        const result = buildTransport(notebookId, currentPageId);
        if (!result.ok) {
          throw new Error(result.reason);
        }
        return result.transport.reconnectToStream(options);
      },
    }),
    [notebookId],
  );

  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages,
    error,
    clearError,
  } = useChat<NotebookAiMessage>({
    transport,
    id: `notebook-ai-${notebookId}-${conversationId}`,
    messages: persistedMessages,
    onFinish: ({ messages: finishedMessages }) => {
      const cleanedMessages = sanitizeNotebookAiMessages(finishedMessages);
      useNotebookAiChats
        .getState()
        .setMessages(notebookId, conversationId, cleanedMessages);
      queueMicrotask(() => setMessages(cleanedMessages));
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const isBusy = isStreaming || isApplyingTransform;
  const unavailableReason = !modelCheck.ok ? modelCheck.reason : undefined;

  useEffect(() => {
    setMessages(
      useNotebookAiChats
        .getState()
        .getConversationMessages(notebookId, conversationId),
    );
    clearError();
    requestCurrentPageIdRef.current = null;
  }, [notebookId, conversationId, setMessages, clearError]);

  useEffect(() => {
    if (unavailableReason || isBusy) return;

    const timer = window.setInterval(() => {
      setPlaceholderIndex(
        (index) => (index + 1) % NOTEBOOK_AI_PLACEHOLDER_HINTS.length,
      );
    }, 4500);

    return () => window.clearInterval(timer);
  }, [unavailableReason, isBusy]);

  // 流式写入页面
  useEffect(() => {
    if (!isStreaming) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    for (const part of lastMsg.parts ?? []) {
      if (part.type === "tool-createPage" || part.type === "tool-updatePage") {
        void handleStreamingWritePart(part as StreamingWritePart, {
          notebookId,
          currentPageId: requestCurrentPageIdRef.current,
        });
      }
    }
  }, [messages, isStreaming, notebookId]);

  // 组件卸载时清理 writer session
  useEffect(() => {
    return () => {
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== "assistant") return;
      for (const part of lastMsg.parts ?? []) {
        if (
          part.type === "tool-createPage" ||
          part.type === "tool-updatePage"
        ) {
          const toolCallId = (part as Record<string, unknown>).toolCallId as
            | string
            | undefined;
          if (toolCallId) cleanupWriterSession(toolCallId);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );

  const composerPlaceholder = unavailableReason
    ? "请先在设置中配置 AI 模型"
    : isBusy
      ? "正在生成结果…"
      : NOTEBOOK_AI_PLACEHOLDER_HINTS[placeholderIndex];

  const handleSend = useCallback(
    (payload: AiComposerPayload) => {
      if (isBusy || unavailableReason) return false;

      const displayText = payload.promptText.trim();
      if (!displayText) return false;

      const currentPageId = getCurrentNotebookAiPageId(notebookId);
      const transformIntent = resolveBlockTypeTransformIntent(displayText);
      const { modelText, metadata } = buildNotebookAiUserMessage({
        payload,
        notebookId,
        currentPageId,
      });
      const cleanedMessages = sanitizeNotebookAiMessages(messages);

      if (transformIntent) {
        if (!currentPageId) {
          toast.error("请先打开要转换的页面。");
          return false;
        }
        if (
          payload.references.some(
            (reference) =>
              Boolean(reference.pageId) && reference.pageId !== currentPageId,
          )
        ) {
          toast.error(
            "待办转换不能同时指向其它页面；请先打开目标页，或移除 @ 引用。",
          );
          return false;
        }

        const page = usePages.getState().pages[currentPageId];
        const targetError = getTransformTargetError(page, notebookId);
        if (targetError) {
          toast.error(targetError);
          return false;
        }
        if (!page) return false;

        let snapshot: BlockTypeTransformSelectionSnapshot;

        try {
          if (capturedSelection) {
            if (
              capturedSelection.version !== 1 ||
              capturedSelection.pageId !== currentPageId ||
              !isBlockTypeTransformSelectionSnapshot(
                capturedSelection.selection,
              ) ||
              capturedSelection.selection.pageId !== currentPageId
            ) {
              throw new Error("选中的内容已不在当前页面，请重新选择后再试。");
            }
            snapshot = capturedSelection.selection;
          } else {
            if (!hasWholePageBlockTypeTransformScope(displayText)) {
              throw new Error(
                "请先选中要转换的完整内容，或明确输入“把当前页全部内容改成待办事项”。",
              );
            }
            const activeEditor = editorRef?.current?.editor;
            const currentBlocks =
              activeEditor && usePages.getState().activePageId === currentPageId
                ? (activeEditor.document as BlockTypeTransformBlock[])
                : getPageBlocks(page.content);
            snapshot = createPageBodyBlockTypeTransformSnapshot(
              currentPageId,
              currentBlocks,
              { protectFirstTitle: !page.localFilePath },
            );
          }
        } catch (error) {
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : "无法确定待办事项转换范围，页面未修改。",
          );
          return false;
        }

        const userMessage = {
          id: createChatMessageId("user"),
          role: "user",
          metadata,
          parts: [{ type: "text", text: modelText }],
        } as NotebookAiMessage;
        const pendingMessages = [...cleanedMessages, userMessage];

        requestCurrentPageIdRef.current = null;
        clearError();
        setMessages(pendingMessages);
        useNotebookAiChats
          .getState()
          .setMessages(notebookId, conversationId, pendingMessages);
        onConsumeCapturedSelection?.();
        setIsApplyingTransform(true);

        void (async () => {
          let assistantText: string;

          try {
            const latestPage = usePages.getState().pages[currentPageId];
            const latestTargetError = getTransformTargetError(
              latestPage,
              notebookId,
            );
            if (latestTargetError) throw new Error(latestTargetError);

            const activeEditor = editorRef?.current?.editor;
            const isTargetEditorActive =
              Boolean(activeEditor) &&
              usePages.getState().activePageId === currentPageId &&
              getCurrentNotebookAiPageId(notebookId) === currentPageId;
            let convertedCount: number;

            if (activeEditor && isTargetEditorActive) {
              const result = applyBlockTypeTransformToEditor(
                activeEditor,
                snapshot,
              );
              const saved = await usePages
                .getState()
                .writePageContent(
                  currentPageId,
                  activeEditor.document as JSONContent,
                );
              if (!saved) {
                throw new Error("转换结果未能保存，未完成本轮操作。");
              }
              convertedCount = result.convertedCount;
            } else {
              const plan = planBlockTypeTransform(
                snapshot,
                getPageBlocks(latestPage?.content),
              );
              const saved = await usePages
                .getState()
                .replaceBlockRange(
                  currentPageId,
                  plan.startBlockId,
                  plan.endBlockId,
                  plan.replacementBlocks as JSONContent,
                );
              if (!saved) {
                throw new Error("目标内容已变化，未转换待办事项。");
              }
              convertedCount = plan.convertedCount;
            }

            assistantText = `已转换为 ${convertedCount} 个原生待办事项。`;
            toast.success(assistantText);
          } catch (error) {
            const reason =
              error instanceof Error && error.message
                ? error.message
                : "转换待办事项失败，页面未修改。";
            assistantText = `未完成转换：${reason}`;
            toast.error(reason);
          }

          const assistantMessage = {
            id: createChatMessageId("assistant"),
            role: "assistant",
            parts: [{ type: "text", text: assistantText }],
          } as NotebookAiMessage;
          const finishedMessages = sanitizeNotebookAiMessages([
            ...pendingMessages,
            assistantMessage,
          ]);
          useNotebookAiChats
            .getState()
            .setMessages(notebookId, conversationId, finishedMessages);
          setMessages(finishedMessages);
          setIsApplyingTransform(false);
        })();

        return true;
      }

      requestCurrentPageIdRef.current = currentPageId;
      if (cleanedMessages !== messages) {
        setMessages(cleanedMessages);
        useNotebookAiChats
          .getState()
          .setMessages(notebookId, conversationId, cleanedMessages);
      }

      clearError();
      void sendMessage({ text: modelText, metadata });
      onConsumeCapturedSelection?.();
      return true;
    },
    [
      isBusy,
      unavailableReason,
      notebookId,
      conversationId,
      messages,
      setMessages,
      clearError,
      sendMessage,
      capturedSelection,
      editorRef,
      onConsumeCapturedSelection,
    ],
  );

  const persistCurrentConversation = useCallback(() => {
    useNotebookAiChats
      .getState()
      .setMessages(
        notebookId,
        conversationId,
        sanitizeNotebookAiMessages(messages),
      );
  }, [notebookId, conversationId, messages]);

  const handleNewConversation = useCallback(() => {
    if (isBusy) return;
    persistCurrentConversation();
    clearError();
    requestCurrentPageIdRef.current = null;
    onConsumeCapturedSelection?.();
    const nextConversationId = useNotebookAiChats
      .getState()
      .createConversation(notebookId);
    setConversationId(nextConversationId);
    setMessages([]);
  }, [
    isBusy,
    persistCurrentConversation,
    clearError,
    notebookId,
    setMessages,
    onConsumeCapturedSelection,
  ]);

  const handleSelectConversation = useCallback(
    (nextConversationId: string) => {
      if (isBusy || nextConversationId === conversationId) return;
      persistCurrentConversation();
      const chats = useNotebookAiChats.getState();
      chats.setActiveConversation(notebookId, nextConversationId);
      const nextMessages = chats.getConversationMessages(
        notebookId,
        nextConversationId,
      );
      clearError();
      requestCurrentPageIdRef.current = null;
      onConsumeCapturedSelection?.();
      setConversationId(nextConversationId);
      setMessages(nextMessages);
    },
    [
      isBusy,
      conversationId,
      notebookId,
      clearError,
      setMessages,
      persistCurrentConversation,
      onConsumeCapturedSelection,
    ],
  );

  const searchPages = useCallback(
    (query: string) => getNotebookAiReferenceSuggestions(query, notebookId),
    [notebookId],
  );

  // 获取正在流式的消息 id
  const streamingMessageId =
    isStreaming && messages.length > 0
      ? messages[messages.length - 1].id
      : undefined;

  return (
    <div
      onKeyDown={handlePanelKeyDown}
      className="relative flex h-full flex-col overflow-hidden rounded-[12px] bg-[hsl(var(--goose-editor-bg))]"
      style={{ width }}
    >
      {/* 拖拽手柄 */}
      <div
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-[var(--goose-interactive-hover)]"
        onMouseDown={onDragHandleMouseDown}
        aria-hidden="true"
      />

      {/* 头部 */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <Bot
          className="h-4 w-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {notebookName}
        </span>
        <button
          type="button"
          onClick={handleNewConversation}
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label="新建会话"
          title="新建会话"
          disabled={isBusy}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <ConversationHistoryPopover
          notebookId={notebookId}
          onSelectConversation={handleSelectConversation}
          disabled={isBusy}
        />
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground"
          aria-label="关闭 AI 面板"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* 消息区 / 引导区 */}
      {unavailableReason ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="flex max-w-[260px] flex-col items-center gap-3 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--goose-interactive-hover)] text-muted-foreground">
              <CircleAlert className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <p className="text-sm font-medium text-foreground">AI 暂不可用</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {unavailableReason}
            </p>
          </div>
        </div>
      ) : (
        <ChatMessages
          messages={messages}
          streamingMessageId={streamingMessageId}
          editorRef={editorRef}
        />
      )}

      {error ? (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-[8px] border border-destructive bg-[hsl(var(--background))] px-3 py-2 text-xs text-destructive">
          <CircleAlert
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            strokeWidth={1.75}
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium">本轮失败原因</div>
            <div className="mt-0.5 break-words leading-relaxed">
              {formatChatError(error)}
            </div>
          </div>
        </div>
      ) : null}

      {/* 输入框 */}
      <Composer
        onSend={handleSend}
        onStop={stop}
        isStreaming={isBusy}
        disabled={!!unavailableReason}
        placeholder={composerPlaceholder}
        searchPages={searchPages}
        onEscape={onClose}
      />
    </div>
  );
}
