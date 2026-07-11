import { expect, test } from "playwright/test";
import { createUToolsLanguageModel } from "../../src/lib/ai-provider/utoolsLanguageModel";

const baseCallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "读取笔记" }] }],
  tools: [
    {
      type: "function",
      name: "readNote",
      description: "读取一篇笔记",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ],
} as const;

test("uTools LanguageModel 会把 Function Calling 转回现有工具执行器", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const fakeWindow: Record<string, any> = {};
  (globalThis as { window?: unknown }).window = fakeWindow;

  try {
    fakeWindow.utools = {
      ai: async (options: {
        tools?: Array<{ function: { name: string } }>;
      }) => {
        expect(options.tools?.[0]?.function.name).toBe("readNote");
        const result = await fakeWindow.readNote({ id: "page-1" });
        return { content: `已读取：${result.title}` };
      },
    };

    const model = createUToolsLanguageModel({
      modelId: "mock-model",
      executeTool: async ({ toolName, input }) => {
        expect(toolName).toBe("readNote");
        expect(input).toEqual({ id: "page-1" });
        return { title: "测试页面" };
      },
    });

    const result = await model.doGenerate(baseCallOptions as any);
    expect(result.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "readNote",
        providerExecuted: true,
      }),
      expect.objectContaining({
        type: "tool-result",
        toolName: "readNote",
        result: { title: "测试页面" },
      }),
      { type: "text", text: "已读取：测试页面" },
    ]);
    expect(fakeWindow.readNote).toBeUndefined();
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
});

test("uTools LanguageModel 流式透传内容并在结束后恢复 window 同名函数", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const originalReadNote = () => "original";
  const fakeWindow: Record<string, any> = { readNote: originalReadNote };
  (globalThis as { window?: unknown }).window = fakeWindow;

  try {
    fakeWindow.utools = {
      ai: async (
        _options: unknown,
        onChunk: (chunk: { content?: string }) => void,
      ) => {
        await fakeWindow.readNote({ id: "page-1" });
        onChunk({ content: "第一段" });
        onChunk({ content: "第二段" });
        return {};
      },
    };

    const model = createUToolsLanguageModel({
      modelId: "mock-model",
      executeTool: async () => ({ ok: true }),
    });
    const { stream } = await model.doStream(baseCallOptions as any);
    const parts: any[] = [];
    for await (const part of stream) parts.push(part);

    expect(
      parts
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta),
    ).toEqual(["第一段", "第二段"]);
    expect(
      parts.some((part) => part.type === "tool-call" && part.providerExecuted),
    ).toBe(true);
    expect(parts.some((part) => part.type === "tool-result")).toBe(true);
    expect(fakeWindow.readNote).toBe(originalReadNote);
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
});
