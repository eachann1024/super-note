import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { sanitizeNotebookAiMessages } from "@/lib/notebook-ai/messageUtils";
import type { NotebookAiMessage } from "@/lib/notebook-ai/types";
import { uToolsStorage } from "@/lib/storage";

/** 每个会话最多保留的消息条数 */
const MAX_MESSAGES_PER_CONVERSATION = 60;
/** 最多持久化聊天记录的笔记本数 */
const MAX_NOTEBOOKS = 20;
const NOTEBOOK_AI_CHATS_STORAGE_VERSION = 1;

export interface NotebookAiConversation {
  id: string;
  messages: NotebookAiMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface NotebookAiNotebookChatState {
  activeConversationId: string | null;
  conversations: Record<string, NotebookAiConversation>;
  /** 用于超过笔记本上限时淘汰最久未使用的记录 */
  updatedAt: number;
}

interface NotebookAiChatsPersistedState {
  /** notebookId -> 多会话状态 */
  chats: Record<string, NotebookAiNotebookChatState>;
}

interface LegacyNotebookAiChatState {
  messages: NotebookAiMessage[];
  updatedAt: number;
}

export interface NotebookAiChatsState extends NotebookAiChatsPersistedState {
  /** 获取当前激活的会话 ID；尚未创建会话时返回 null */
  getActiveConversationId: (notebookId: string) => string | null;
  /** 获取指定会话的消息；省略 conversationId 时读取当前会话 */
  getConversationMessages: (
    notebookId: string,
    conversationId?: string,
  ) => NotebookAiMessage[];
  /** 获取历史会话，排除空会话并按最近更新时间倒序排列 */
  listConversations: (notebookId: string) => NotebookAiConversation[];
  /** 新建并激活空会话；已有空会话时直接复用 */
  createConversation: (notebookId: string) => string;
  /** 激活已存在的会话；会话不存在时不修改状态 */
  setActiveConversation: (notebookId: string, conversationId: string) => void;
  /** 更新指定会话的消息 */
  setMessages: (
    notebookId: string,
    conversationId: string,
    messages: NotebookAiMessage[],
  ) => void;
  /** 清空全部笔记本会话记录（数据重置/整包恢复使用） */
  clearAllChats: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalizeMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return sanitizeNotebookAiMessages(value as NotebookAiMessage[]).slice(
    -MAX_MESSAGES_PER_CONVERSATION,
  );
}

function createConversationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pruneNotebookChats(
  chats: Record<string, NotebookAiNotebookChatState>,
  protectedNotebookId?: string,
) {
  const notebookIds = Object.keys(chats);
  if (notebookIds.length <= MAX_NOTEBOOKS) return chats;

  const hasRealHistory = (notebookId: string) =>
    Object.values(chats[notebookId].conversations).some(
      (conversation) => conversation.messages.length > 0,
    );
  let removeCount = notebookIds.length - MAX_NOTEBOOKS;
  const nextChats = { ...chats };
  const oldestFirst = (left: string, right: string) => {
    const updatedAtDifference = chats[left].updatedAt - chats[right].updatedAt;
    return updatedAtDifference || left.localeCompare(right);
  };

  // 空会话只是面板的临时占位，不能为了它淘汰已有真实历史。
  const emptyCandidates = notebookIds
    .filter((notebookId) => notebookId !== protectedNotebookId)
    .filter((notebookId) => !hasRealHistory(notebookId))
    .sort(oldestFirst);

  for (const notebookId of emptyCandidates.slice(0, removeCount)) {
    delete nextChats[notebookId];
    removeCount -= 1;
  }

  if (removeCount <= 0) return nextChats;
  if (
    protectedNotebookId &&
    nextChats[protectedNotebookId] &&
    !hasRealHistory(protectedNotebookId)
  ) {
    return nextChats;
  }

  const historyCandidates = Object.keys(nextChats)
    .filter((notebookId) => notebookId !== protectedNotebookId)
    .filter((notebookId) => hasRealHistory(notebookId))
    .sort(oldestFirst);

  for (const notebookId of historyCandidates.slice(0, removeCount)) {
    delete nextChats[notebookId];
  }
  return nextChats;
}

function normalizeConversation(
  conversationId: string,
  value: unknown,
): NotebookAiConversation | null {
  if (!isRecord(value)) return null;

  const messages = normalizeMessages(value.messages);
  const fallbackTimestamp = Date.now();
  const updatedAt = normalizeTimestamp(value.updatedAt, fallbackTimestamp);
  const createdAt = normalizeTimestamp(value.createdAt, updatedAt);

  return {
    id: typeof value.id === "string" && value.id ? value.id : conversationId,
    messages,
    createdAt,
    updatedAt,
  };
}

function normalizeNotebookChatState(
  value: Record<string, unknown>,
): NotebookAiNotebookChatState {
  const conversations = isRecord(value.conversations)
    ? Object.fromEntries(
        Object.entries(value.conversations).flatMap(
          ([conversationId, item]) => {
            const conversation = normalizeConversation(conversationId, item);
            return conversation ? [[conversation.id, conversation]] : [];
          },
        ),
      )
    : {};
  const conversationList = Object.values(conversations);
  const newestConversation = [...conversationList].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )[0];
  const requestedActiveId =
    typeof value.activeConversationId === "string"
      ? value.activeConversationId
      : null;
  const activeConversationId =
    requestedActiveId && conversations[requestedActiveId]
      ? requestedActiveId
      : (newestConversation?.id ?? null);
  const newestUpdatedAt = newestConversation?.updatedAt ?? 0;

  return {
    activeConversationId,
    conversations,
    updatedAt: Math.max(
      normalizeTimestamp(value.updatedAt, newestUpdatedAt),
      newestUpdatedAt,
    ),
  };
}

function migrateLegacyNotebookChatState(
  notebookId: string,
  value: LegacyNotebookAiChatState,
): NotebookAiNotebookChatState {
  const updatedAt = normalizeTimestamp(value.updatedAt, Date.now());
  const conversationId = `legacy-${notebookId}`;

  return {
    activeConversationId: conversationId,
    conversations: {
      [conversationId]: {
        id: conversationId,
        messages: normalizeMessages(value.messages),
        createdAt: updatedAt,
        updatedAt,
      },
    },
    updatedAt,
  };
}

/** Zustand persist v0（单会话）到 v1（多会话）的兼容迁移。 */
export function migrateNotebookAiChatsState(
  persistedState: unknown,
): NotebookAiChatsPersistedState {
  if (!isRecord(persistedState) || !isRecord(persistedState.chats)) {
    return { chats: {} };
  }

  const chats = Object.fromEntries(
    Object.entries(persistedState.chats).flatMap(([notebookId, value]) => {
      if (!isRecord(value)) return [];

      const notebookChatState = isRecord(value.conversations)
        ? normalizeNotebookChatState(value)
        : migrateLegacyNotebookChatState(
            notebookId,
            value as unknown as LegacyNotebookAiChatState,
          );
      return [[notebookId, notebookChatState]];
    }),
  );

  return { chats: pruneNotebookChats(chats) };
}

export const useNotebookAiChats = create<NotebookAiChatsState>()(
  persist(
    (set, get) => ({
      chats: {},

      getActiveConversationId: (notebookId) => {
        return get().chats[notebookId]?.activeConversationId ?? null;
      },

      getConversationMessages: (notebookId, conversationId) => {
        const notebookChat = get().chats[notebookId];
        const resolvedConversationId =
          conversationId ?? notebookChat?.activeConversationId;
        if (!resolvedConversationId) return [];

        return normalizeMessages(
          notebookChat?.conversations[resolvedConversationId]?.messages,
        );
      },

      listConversations: (notebookId) => {
        const conversations = Object.values(
          get().chats[notebookId]?.conversations ?? {},
        );

        return conversations
          .map((conversation) => ({
            ...conversation,
            messages: normalizeMessages(conversation.messages),
          }))
          .filter((conversation) => conversation.messages.length > 0)
          .sort((left, right) => right.updatedAt - left.updatedAt);
      },

      createConversation: (notebookId) => {
        let conversationId = "";

        set((state) => {
          const now = Date.now();
          const currentNotebookChat = state.chats[notebookId];
          const emptyConversation = Object.values(
            currentNotebookChat?.conversations ?? {},
          )
            .filter((conversation) => conversation.messages.length === 0)
            .sort((left, right) => right.updatedAt - left.updatedAt)[0];

          if (emptyConversation) {
            conversationId = emptyConversation.id;
            return {
              chats: pruneNotebookChats(
                {
                  ...state.chats,
                  [notebookId]: {
                    ...currentNotebookChat,
                    activeConversationId: conversationId,
                    updatedAt: now,
                  },
                },
                notebookId,
              ),
            };
          }

          conversationId = createConversationId();
          const conversation: NotebookAiConversation = {
            id: conversationId,
            messages: [],
            createdAt: now,
            updatedAt: now,
          };
          const notebookChat: NotebookAiNotebookChatState = {
            activeConversationId: conversationId,
            conversations: {
              ...(currentNotebookChat?.conversations ?? {}),
              [conversationId]: conversation,
            },
            updatedAt: now,
          };

          return {
            chats: pruneNotebookChats(
              {
                ...state.chats,
                [notebookId]: notebookChat,
              },
              notebookId,
            ),
          };
        });

        return conversationId;
      },

      setActiveConversation: (notebookId, conversationId) => {
        set((state) => {
          const notebookChat = state.chats[notebookId];
          if (!notebookChat?.conversations[conversationId]) return state;
          if (notebookChat.activeConversationId === conversationId)
            return state;

          return {
            chats: {
              ...state.chats,
              [notebookId]: {
                ...notebookChat,
                activeConversationId: conversationId,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      setMessages: (notebookId, conversationId, messages) => {
        set((state) => {
          const now = Date.now();
          const currentNotebookChat = state.chats[notebookId];
          const currentConversation =
            currentNotebookChat?.conversations[conversationId];
          const conversation: NotebookAiConversation = {
            id: conversationId,
            messages: normalizeMessages(messages),
            createdAt: currentConversation?.createdAt ?? now,
            updatedAt: now,
          };
          const notebookChat: NotebookAiNotebookChatState = {
            activeConversationId:
              currentNotebookChat?.activeConversationId ?? conversationId,
            conversations: {
              ...(currentNotebookChat?.conversations ?? {}),
              [conversationId]: conversation,
            },
            updatedAt: now,
          };

          return {
            chats: pruneNotebookChats(
              {
                ...state.chats,
                [notebookId]: notebookChat,
              },
              notebookId,
            ),
          };
        });
      },

      clearAllChats: () => set({ chats: {} }),
    }),
    {
      name: "goose-note-notebook-ai-chats",
      version: NOTEBOOK_AI_CHATS_STORAGE_VERSION,
      storage: createJSONStorage(() => uToolsStorage),
      skipHydration: true,
      migrate: (persistedState: unknown) =>
        migrateNotebookAiChatsState(persistedState),
      // 只持久化 chats，不持久化函数
      partialize: (state) => ({ chats: state.chats }),
    },
  ),
);
