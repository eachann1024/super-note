export type CustomAIProtocol = "openai" | "claude";

export interface AIModelOption {
  id: string;
  label: string;
  description?: string;
}

export type AIProviderMode = "utools" | "custom";
export type AIReasoningLevel = "default" | "low" | "medium" | "high";

export interface AISettingsLike {
  enabled: boolean;
  selectedModelId: string | null;
  workspaceReasoningLevel: AIReasoningLevel;
  useCustomProvider: boolean;
  customProtocol: CustomAIProtocol;
  customOpenAIBaseURL: string;
  customClaudeBaseURL: string;
  customOpenAIApiKey: string;
  customClaudeApiKey: string;
  customModelOptions: AIModelOption[];
}

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content?: string;
}

export type AIStreamPhase = "connecting" | "thinking" | "generating" | "finishing";

export interface AIStreamUpdate {
  phase: AIStreamPhase;
  text: string;
  reasoningText: string;
}

export interface AIRequestOverrides {
  selectedModelId?: string | null;
  reasoningLevel?: AIReasoningLevel | null;
}

export interface RunAITextOptions {
  abortSignal?: AbortSignal;
  requestOverrides?: AIRequestOverrides;
}

export interface RunAITextStreamOptions extends RunAITextOptions {
  onUpdate?: (update: AIStreamUpdate) => void;
  streamIdleTimeoutMs?: number;
}

export interface UToolsAiApi {
  ai?: (
    option: {
      model?: string;
      messages: AIMessage[];
      tools?: Array<{
        type: "function";
        function: {
          name: string;
          description: string;
          parameters: Record<string, unknown>;
          required?: string[];
        };
      }>;
    },
    streamCallback?: (chunk: {
      role?: "system" | "user" | "assistant";
      content?: string;
      reasoning_content?: string;
    }) => void,
  ) => Promise<{
    content?: string;
    reasoning_content?: string;
  }> & { abort?: () => void };
}
