import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { useSettings } from "@/stores/useSettings";
import { getAIAvailability } from "@/lib/ai-provider";
import { DEFAULT_UTOOLS_MODEL } from "@/lib/ai-provider/modelCatalog";
import {
  createUToolsLanguageModel,
  type CreateUToolsLanguageModelOptions,
} from "@/lib/ai-provider/utoolsLanguageModel";

export type ModelAvailability =
  | { ok: true; model: LanguageModel }
  | { ok: false; reason: string };

/**
 * 从 settings 构造 LanguageModel。
 * 支持 uTools 原生 AI、openai-compatible 和 anthropic 三种来源。
 */
export function buildLanguageModel(
  options?: Pick<CreateUToolsLanguageModelOptions, "executeTool">,
): ModelAvailability {
  const ai = useSettings.getState().ai;

  if (!ai.enabled) {
    return { ok: false, reason: "AI 功能未开启，请前往设置启用 AI 助手。" };
  }

  if (!ai.useCustomProvider) {
    const availability = getAIAvailability(ai);
    if (!availability.ok) {
      return { ok: false, reason: availability.reason };
    }
    const modelId =
      (ai.workspaceSelectedModelId ?? ai.selectedModelId ?? DEFAULT_UTOOLS_MODEL).trim();
    return {
      ok: true,
      model: createUToolsLanguageModel({
        modelId: modelId || DEFAULT_UTOOLS_MODEL,
        executeTool: options?.executeTool,
      }),
    };
  }

  const modelId =
    (ai.workspaceSelectedModelId ?? ai.selectedModelId ?? "").trim();
  if (!modelId) {
    return {
      ok: false,
      reason: "请在设置中选择一个模型后再使用 AI 笔记本功能。",
    };
  }

  try {
    if (ai.customProtocol === "claude") {
      const baseURL = (ai.customClaudeBaseURL || "https://api.anthropic.com").replace(
        /\/+$/,
        "",
      );
      const provider = createAnthropic({
        apiKey: ai.customClaudeApiKey || "placeholder",
        baseURL,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      return { ok: true, model: provider(modelId) };
    }

    // 默认 openai-compatible
    const baseURL = (
      ai.customOpenAIBaseURL || "https://api.openai.com/v1"
    ).replace(/\/+$/, "");
    const provider = createOpenAICompatible({
      name: "custom-openai",
      baseURL,
      apiKey: ai.customOpenAIApiKey || "placeholder",
    });
    return { ok: true, model: provider.chatModel(modelId) };
  } catch (err) {
    return {
      ok: false,
      reason: `构造模型失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
