import type {
  JSONValue,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FunctionTool,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { getUToolsApi } from "./modelCatalog";

type ToolExecution = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  signal?: AbortSignal;
};

export interface CreateUToolsLanguageModelOptions {
  modelId: string;
  executeTool?: (execution: ToolExecution) => Promise<unknown>;
}

const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: undefined,
    text: undefined,
    reasoning: undefined,
  },
};

function toJSONValue(value: unknown): NonNullable<JSONValue> {
  if (value == null) return { value: null };
  try {
    const serialized = JSON.parse(JSON.stringify(value)) as JSONValue;
    return serialized == null ? { value: serialized } : serialized;
  } catch {
    return String(value);
  }
}

function promptPartToText(part: Record<string, unknown>): string {
  if (part.type === "text" || part.type === "reasoning") {
    return typeof part.text === "string" ? part.text : "";
  }
  if (part.type === "tool-call") {
    return `[工具调用 ${String(part.toolName ?? "")}] ${JSON.stringify(part.input ?? {})}`;
  }
  if (part.type === "tool-result") {
    return `[工具结果 ${String(part.toolName ?? "")}] ${JSON.stringify(part.output ?? null)}`;
  }
  return "";
}

function toUToolsMessages(prompt: LanguageModelV3CallOptions["prompt"]) {
  return prompt.map((message) => {
    if (message.role === "system") {
      return { role: "system" as const, content: message.content };
    }

    const content = message.content
      .map((part) =>
        promptPartToText(part as unknown as Record<string, unknown>),
      )
      .filter(Boolean)
      .join("\n");

    // uTools 的消息协议没有 tool role；工具结果作为 user 上下文继续传入。
    return {
      role:
        message.role === "assistant"
          ? ("assistant" as const)
          : ("user" as const),
      content,
    };
  });
}

function toUToolsTools(tools: LanguageModelV3CallOptions["tools"]) {
  return (tools ?? [])
    .filter(
      (tool): tool is LanguageModelV3FunctionTool => tool.type === "function",
    )
    .map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description ?? tool.name,
        parameters: tool.inputSchema as Record<string, unknown>,
        required: Array.isArray(tool.inputSchema.required)
          ? tool.inputSchema.required.filter(
              (item): item is string => typeof item === "string",
            )
          : undefined,
      },
    }));
}

interface InstalledToolHandlers {
  restore: () => void;
}

function installToolHandlers(options: {
  tools: ReturnType<typeof toUToolsTools>;
  signal?: AbortSignal;
  executeTool?: CreateUToolsLanguageModelOptions["executeTool"];
  onToolCall?: (part: LanguageModelV3StreamPart) => void;
  collectedContent?: LanguageModelV3Content[];
}): InstalledToolHandlers {
  if (typeof window === "undefined" || options.tools.length === 0) {
    return { restore: () => {} };
  }

  const target = window as unknown as Record<string, unknown>;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  let sequence = 0;

  for (const tool of options.tools) {
    const name = tool.function.name;
    previous.set(name, Object.getOwnPropertyDescriptor(target, name));

    Object.defineProperty(target, name, {
      configurable: true,
      value: async (input: unknown) => {
        const toolCallId = `utools-${Date.now()}-${sequence++}`;
        const serializedInput = JSON.stringify(input ?? {});
        const toolCall = {
          type: "tool-call" as const,
          toolCallId,
          toolName: name,
          input: serializedInput,
          providerExecuted: true,
        };
        options.collectedContent?.push(toolCall);
        options.onToolCall?.(toolCall);

        try {
          if (!options.executeTool) {
            throw new Error(
              `uTools AI 请求了工具 ${name}，但当前入口未提供工具执行器`,
            );
          }
          const output = await options.executeTool({
            toolCallId,
            toolName: name,
            input,
            signal: options.signal,
          });
          const result = {
            type: "tool-result" as const,
            toolCallId,
            toolName: name,
            result: toJSONValue(output),
          };
          options.collectedContent?.push(result);
          options.onToolCall?.(result);
          return output;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const result = {
            type: "tool-result" as const,
            toolCallId,
            toolName: name,
            result: message,
            isError: true,
          };
          options.collectedContent?.push(result);
          options.onToolCall?.(result);
          throw error;
        }
      },
    });
  }

  return {
    restore: () => {
      for (const [name, descriptor] of previous) {
        if (descriptor) {
          Object.defineProperty(target, name, descriptor);
        } else {
          delete target[name];
        }
      }
    },
  };
}

/**
 * 把 uTools 7+ 原生 AI（含其 provider-executed Function Calling）适配为 AI SDK v3 模型。
 * uTools 会直接调用挂在 window 上的同名函数；这里把调用转回现有 notebook tool executor，
 * 并把调用/结果同步送入 AI SDK 流，避免 UI 静默执行工具。
 */
export function createUToolsLanguageModel(
  options: CreateUToolsLanguageModelOptions,
): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "utools",
    modelId: options.modelId,
    supportedUrls: {},

    async doGenerate(callOptions) {
      if (callOptions.abortSignal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      const utoolsAi = getUToolsApi()?.ai;
      if (!utoolsAi) throw new Error("当前 uTools 环境未提供 AI 方法");

      const tools = toUToolsTools(callOptions.tools);
      const content: LanguageModelV3Content[] = [];
      const installed = installToolHandlers({
        tools,
        signal: callOptions.abortSignal,
        executeTool: options.executeTool,
        collectedContent: content,
      });

      let request: ReturnType<typeof utoolsAi> | null = null;
      const abort = () => request?.abort?.();
      callOptions.abortSignal?.addEventListener("abort", abort, { once: true });
      try {
        request = utoolsAi({
          model: options.modelId,
          messages: toUToolsMessages(callOptions.prompt),
          tools: tools.length ? tools : undefined,
        });
        const result = await request;
        if (result.reasoning_content) {
          content.push({ type: "reasoning", text: result.reasoning_content });
        }
        content.push({ type: "text", text: result.content ?? "" });
        return {
          content,
          finishReason: { unified: "stop", raw: undefined },
          usage: EMPTY_USAGE,
          warnings: [],
        };
      } finally {
        callOptions.abortSignal?.removeEventListener("abort", abort);
        installed.restore();
      }
    },

    async doStream(callOptions) {
      if (callOptions.abortSignal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      const utoolsAi = getUToolsApi()?.ai;
      if (!utoolsAi) throw new Error("当前 uTools 环境未提供 AI 方法");
      const tools = toUToolsTools(callOptions.tools);

      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            let request: ReturnType<typeof utoolsAi> | null = null;
            let textStarted = false;
            let reasoningStarted = false;
            let closed = false;
            const textId = `utools-text-${Date.now()}`;
            const reasoningId = `utools-reasoning-${Date.now()}`;

            const enqueue = (part: LanguageModelV3StreamPart) => {
              if (!closed) controller.enqueue(part);
            };
            const installed = installToolHandlers({
              tools,
              signal: callOptions.abortSignal,
              executeTool: options.executeTool,
              onToolCall: enqueue,
            });
            const abort = () => request?.abort?.();

            callOptions.abortSignal?.addEventListener("abort", abort, {
              once: true,
            });
            enqueue({ type: "stream-start", warnings: [] });

            try {
              request = utoolsAi(
                {
                  model: options.modelId,
                  messages: toUToolsMessages(callOptions.prompt),
                  tools: tools.length ? tools : undefined,
                },
                (chunk) => {
                  if (chunk.reasoning_content) {
                    if (!reasoningStarted) {
                      reasoningStarted = true;
                      enqueue({ type: "reasoning-start", id: reasoningId });
                    }
                    enqueue({
                      type: "reasoning-delta",
                      id: reasoningId,
                      delta: chunk.reasoning_content,
                    });
                  }
                  if (chunk.content) {
                    if (!textStarted) {
                      textStarted = true;
                      enqueue({ type: "text-start", id: textId });
                    }
                    enqueue({
                      type: "text-delta",
                      id: textId,
                      delta: chunk.content,
                    });
                  }
                },
              );
            } catch (error) {
              closed = true;
              callOptions.abortSignal?.removeEventListener("abort", abort);
              installed.restore();
              controller.error(error);
              return;
            }

            void Promise.resolve(request)
              .then((result) => {
                // 某些 uTools 版本即使传了 callback，仍只在最终结果返回文本。
                if (!textStarted && result?.content) {
                  textStarted = true;
                  enqueue({ type: "text-start", id: textId });
                  enqueue({
                    type: "text-delta",
                    id: textId,
                    delta: result.content,
                  });
                }
                if (!reasoningStarted && result?.reasoning_content) {
                  reasoningStarted = true;
                  enqueue({ type: "reasoning-start", id: reasoningId });
                  enqueue({
                    type: "reasoning-delta",
                    id: reasoningId,
                    delta: result.reasoning_content,
                  });
                }
                if (reasoningStarted)
                  enqueue({ type: "reasoning-end", id: reasoningId });
                if (textStarted) enqueue({ type: "text-end", id: textId });
                enqueue({
                  type: "finish",
                  usage: EMPTY_USAGE,
                  finishReason: { unified: "stop", raw: undefined },
                });
                closed = true;
                controller.close();
              })
              .catch((error) => {
                if (!closed) controller.error(error);
              })
              .finally(() => {
                closed = true;
                callOptions.abortSignal?.removeEventListener("abort", abort);
                installed.restore();
              });
          },
        }),
      };
    },
  };
}
