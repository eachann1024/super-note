import { expect, test } from "playwright/test";
import type { NotebookAiMessage } from "../../src/lib/notebook-ai/types";
import {
  migrateNotebookAiChatsState,
  useNotebookAiChats,
} from "../../src/stores/useNotebookAiChats";

function createMessage(index: number, displayText = `消息 ${index}`) {
  return {
    id: `message-${index}`,
    role: "user",
    metadata: { displayText },
    parts: [{ type: "text", text: displayText }],
  } as NotebookAiMessage;
}

test.beforeEach(() => {
  useNotebookAiChats.setState({ chats: {} });
});

test("持久化配置保留原 key 并启用 v1 迁移", () => {
  const options = useNotebookAiChats.persist.getOptions();

  expect(options.name).toBe("goose-note-notebook-ai-chats");
  expect(options.version).toBe(1);
  expect(typeof options.migrate).toBe("function");
});

test("旧单会话数据迁移为一条激活会话", () => {
  const messages = Array.from({ length: 65 }, (_, index) =>
    createMessage(index),
  );
  const migrated = migrateNotebookAiChatsState({
    chats: {
      notebookA: {
        messages,
        updatedAt: 1234,
      },
    },
  });

  const notebookChat = migrated.chats.notebookA;
  expect(notebookChat.activeConversationId).toBe("legacy-notebookA");
  expect(Object.keys(notebookChat.conversations)).toEqual(["legacy-notebookA"]);
  expect(notebookChat.conversations["legacy-notebookA"].messages).toHaveLength(
    60,
  );
  expect(notebookChat.conversations["legacy-notebookA"].messages[0].id).toBe(
    "message-5",
  );
  expect(notebookChat.conversations["legacy-notebookA"].createdAt).toBe(1234);
  expect(notebookChat.updatedAt).toBe(1234);
});

test("空会话不进入历史且重复新建会复用", () => {
  const store = useNotebookAiChats.getState();
  const firstConversationId = store.createConversation("notebookA");
  const reusedConversationId = store.createConversation("notebookA");

  expect(reusedConversationId).toBe(firstConversationId);
  expect(store.getActiveConversationId("notebookA")).toBe(firstConversationId);
  expect(store.getConversationMessages("notebookA")).toEqual([]);
  expect(store.listConversations("notebookA")).toEqual([]);
});

test("每条非空会话独立保存、切换并最多保留 60 条消息", () => {
  const store = useNotebookAiChats.getState();
  const firstConversationId = store.createConversation("notebookA");
  store.setMessages(
    "notebookA",
    firstConversationId,
    Array.from({ length: 65 }, (_, index) => createMessage(index)),
  );

  const secondConversationId = store.createConversation("notebookA");
  expect(secondConversationId).not.toBe(firstConversationId);
  store.setMessages("notebookA", secondConversationId, [
    createMessage(100, "第二段会话"),
  ]);

  expect(store.listConversations("notebookA")).toHaveLength(2);
  expect(
    store.getConversationMessages("notebookA", firstConversationId),
  ).toHaveLength(60);
  expect(
    store.getConversationMessages("notebookA", firstConversationId)[0].id,
  ).toBe("message-5");

  store.setActiveConversation("notebookA", firstConversationId);
  expect(store.getActiveConversationId("notebookA")).toBe(firstConversationId);
  expect(store.getConversationMessages("notebookA")).toHaveLength(60);
});

test("不存在的会话不能被激活", () => {
  const store = useNotebookAiChats.getState();
  const conversationId = store.createConversation("notebookA");

  store.setActiveConversation("notebookA", "missing-conversation");

  expect(store.getActiveConversationId("notebookA")).toBe(conversationId);
});

test("保存非当前会话时不会把激活指针切回旧会话", () => {
  const store = useNotebookAiChats.getState();
  const firstConversationId = store.createConversation("notebookA");
  store.setMessages("notebookA", firstConversationId, [createMessage(1)]);
  const secondConversationId = store.createConversation("notebookA");
  store.setMessages("notebookA", secondConversationId, [createMessage(2)]);

  store.setActiveConversation("notebookA", firstConversationId);
  store.setMessages("notebookA", secondConversationId, [createMessage(3)]);

  expect(store.getActiveConversationId("notebookA")).toBe(firstConversationId);
});

test("最多保留 20 个笔记本且不限制单个笔记本的历史会话数", () => {
  const store = useNotebookAiChats.getState();

  for (let index = 0; index < 21; index += 1) {
    store.createConversation(`notebook-${index}`);
  }

  expect(Object.keys(useNotebookAiChats.getState().chats)).toHaveLength(20);
  expect(useNotebookAiChats.getState().chats["notebook-20"]).toBeDefined();

  for (let index = 0; index < 25; index += 1) {
    const conversationId = store.createConversation("notebook-history");
    store.setMessages("notebook-history", conversationId, [
      createMessage(index, `会话 ${index}`),
    ]);
  }

  expect(store.listConversations("notebook-history")).toHaveLength(25);
});

test("打开空面板不会为占位会话淘汰已有真实历史", () => {
  const store = useNotebookAiChats.getState();

  for (let index = 0; index < 20; index += 1) {
    const notebookId = `history-${index}`;
    const conversationId = store.createConversation(notebookId);
    store.setMessages(notebookId, conversationId, [createMessage(index)]);
  }

  const emptyConversationId = store.createConversation("empty-panel");
  expect(Object.keys(useNotebookAiChats.getState().chats)).toHaveLength(21);
  expect(useNotebookAiChats.getState().chats["history-0"]).toBeDefined();

  store.setMessages("empty-panel", emptyConversationId, [createMessage(100)]);
  expect(Object.keys(useNotebookAiChats.getState().chats)).toHaveLength(20);
  expect(useNotebookAiChats.getState().chats["empty-panel"]).toBeDefined();
});

test("清空全部会话记录", () => {
  const store = useNotebookAiChats.getState();
  store.createConversation("notebookA");
  store.createConversation("notebookB");

  store.clearAllChats();

  expect(useNotebookAiChats.getState().chats).toEqual({});
});
