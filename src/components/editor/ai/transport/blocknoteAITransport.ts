// BlockNote xl-ai 的 ChatTransport 适配器：把项目现有 AI Settings 桥到 Vercel AI SDK。
// v1 支持自定义 OpenAI 兼容协议与 Claude；uTools 内置模型暂未接入（需写自定义 LanguageModelV2）。

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { aiDocumentFormats, ClientSideTransport } from "@blocknote/xl-ai";
import type { ChatTransport, UIMessage } from "ai";
import type { AISettingsLike } from "@/lib/ai-provider/types";

function buildModel(
  settings: AISettingsLike,
  modelId: string,
  fetchImpl: typeof fetch,
) {
  if (!settings.enabled) {
    throw new Error("AI 助手尚未开启，请先到设置中打开");
  }
  if (!settings.useCustomProvider) {
    throw new Error(
      "uTools 内置模型暂不支持编辑器内 BlockNote AI 菜单。请在 设置 → AI 助手 中切换到自定义 OpenAI 或 Claude provider。",
    );
  }
  const apiKey = (
    settings.customProtocol === "openai"
      ? settings.customOpenAIApiKey
      : settings.customClaudeApiKey
  ).trim();
  if (!apiKey) {
    throw new Error('未填写 API Key。请前往"设置 -> AI 助手 -> 自定义 AI"检查配置。');
  }

  const normalizeBase = (url: string, fallback: string) =>
    (url || fallback).replace(/\/+$/, "");

  if (settings.customProtocol === "openai") {
    const provider = createOpenAICompatible({
      name: "goose-openai",
      baseURL: normalizeBase(settings.customOpenAIBaseURL, "https://api.openai.com/v1"),
      apiKey: settings.customOpenAIApiKey,
      fetch: fetchImpl,
    });
    return provider.chatModel(modelId);
  }

  // Claude
  const provider = createAnthropic({
    baseURL: normalizeBase(settings.customClaudeBaseURL, "https://api.anthropic.com/v1"),
    apiKey: settings.customClaudeApiKey,
    headers: {
      // 浏览器侧 Anthropic CORS 需要这个 header
      "anthropic-dangerous-direct-browser-access": "true",
    },
    fetch: fetchImpl,
  });
  return provider(modelId);
}

export interface CreateGooseAITransportOptions {
  getSettings: () => AISettingsLike;
  getModelId: () => string;
  /**
   * 宿主注入的 fetch（如 Tauri plugin-http，绕过 WebView CORS）。
   * 未提供时回退 globalThis.fetch —— uTools 端行为与浏览器直连完全一致。
   */
  getCustomFetch?: () => typeof fetch | undefined;
}

// 工厂函数：xl-ai 需要 LLM 返回结构化 tool calls（不是纯文本），因此必须用
// xl-ai 提供的 ClientSideTransport — 它会带上 tools + toolChoice:"required"。
export function createGooseAITransport(
  options: CreateGooseAITransportOptions,
): ChatTransport<UIMessage> {
  const sendMessages: ChatTransport<UIMessage>["sendMessages"] = async (params) => {
    const settings = options.getSettings();
    const modelId = options.getModelId();
    const fetchImpl = options.getCustomFetch?.() ?? globalThis.fetch;
    const model = buildModel(settings, modelId, fetchImpl);
    const inner = new ClientSideTransport({
      model,
      systemPrompt: aiDocumentFormats.html.systemPrompt,
    });
    return inner.sendMessages(params);
  };

  const reconnectToStream: ChatTransport<UIMessage>["reconnectToStream"] = async () => null;

  return {
    sendMessages,
    reconnectToStream,
  };
}
