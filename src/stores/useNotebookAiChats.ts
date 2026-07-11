import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { uToolsStorage } from "@/lib/storage";
import { sanitizeNotebookAiMessages } from "@/lib/notebook-ai/messageUtils";
import type { NotebookAiMessage, NotebookAiChatState } from "@/lib/notebook-ai/types";

/** 每个笔记本最多保留的消息条数 */
const MAX_MESSAGES_PER_NOTEBOOK = 60;
/** 最多持久化的笔记本会话数 */
const MAX_NOTEBOOKS = 20;

interface NotebookAiChatsState {
  /** notebookId → 会话状态 */
  chats: Record<string, NotebookAiChatState>;

  /** 获取指定笔记本的消息列表，不存在时返回空数组 */
  getMessages: (notebookId: string) => NotebookAiMessage[];

  /** 更新指定笔记本的消息列表（由 useChat onMessage / onFinish 等回调触发） */
  setMessages: (notebookId: string, messages: NotebookAiMessage[]) => void;

  /** 清空指定笔记本的会话记录 */
  clearChat: (notebookId: string) => void;
  /** 清空全部笔记本会话记录（数据重置/整包恢复使用） */
  clearAllChats: () => void;
}

export const useNotebookAiChats = create<NotebookAiChatsState>()(
  persist(
    (set, get) => ({
      chats: {},

      getMessages: (notebookId) => {
        return sanitizeNotebookAiMessages(get().chats[notebookId]?.messages ?? []);
      },

      setMessages: (notebookId, messages) => {
        set((state) => {
          // 截断到最大条数
          const trimmed = sanitizeNotebookAiMessages(messages).slice(
            -MAX_MESSAGES_PER_NOTEBOOK,
          );

          const updatedChats: Record<string, NotebookAiChatState> = {
            ...state.chats,
            [notebookId]: {
              messages: trimmed,
              updatedAt: Date.now(),
            },
          };

          // 超出 MAX_NOTEBOOKS 时，按 updatedAt 淘汰最旧的
          const keys = Object.keys(updatedChats);
          if (keys.length > MAX_NOTEBOOKS) {
            const sorted = keys
              .map((k) => ({ k, updatedAt: updatedChats[k].updatedAt }))
              .sort((a, b) => a.updatedAt - b.updatedAt);

            const toRemove = sorted.slice(0, keys.length - MAX_NOTEBOOKS);
            for (const { k } of toRemove) {
              delete updatedChats[k];
            }
          }

          return { chats: updatedChats };
        });
      },

      clearChat: (notebookId) => {
        set((state) => {
          const { [notebookId]: _removed, ...rest } = state.chats;
          return { chats: rest };
        });
      },
      clearAllChats: () => set({ chats: {} }),
    }),
    {
      name: "goose-note-notebook-ai-chats",
      storage: createJSONStorage(() => uToolsStorage),
      skipHydration: true,
      // 只持久化 chats，不持久化函数
      partialize: (state) => ({
        chats: state.chats,
      }),
    },
  ),
);
