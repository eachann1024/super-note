import { DEFAULT_CLAUDE_BASE_URL, DEFAULT_OPENAI_BASE_URL, type AIModelOption, type CustomAIProtocol, type AIReasoningLevel } from '@/lib/ai-provider'
import type { AISettings } from '../types'
import { normalizeAIModelOptions, normalizeAIBaseURL, normalizeAIApiKey } from '../types'

export interface AISliceState {
    ai: AISettings
}

export interface AISliceActions {
    setAIEnabled: (enabled: boolean) => void
    setAISelectedModelId: (modelId: string | null) => void
    setAIWorkspaceSelectedModelId: (modelId: string | null) => void
    setAIWorkspaceReasoningLevel: (level: AIReasoningLevel) => void
    saveAICustomConfig: (config: {
        protocol: CustomAIProtocol
        baseURL: string
        apiKey: string
        modelOptions: AIModelOption[]
    }) => void
}

export type AISlice = AISliceState & AISliceActions

export const AI_INITIAL_STATE: AISliceState = {
    ai: {
        enabled: false,
        selectedModelId: null,
        workspaceSelectedModelId: null,
        workspaceReasoningLevel: 'default',
        useCustomProvider: true,
        customProtocol: 'openai',
        customOpenAIBaseURL: DEFAULT_OPENAI_BASE_URL,
        customClaudeBaseURL: DEFAULT_CLAUDE_BASE_URL,
        customOpenAIApiKey: '',
        customClaudeApiKey: '',
        customModelOptions: [],
    },
}

type SetFn = (updater: Partial<AISlice> | ((state: AISlice) => Partial<AISlice>)) => void

export function createAISlice(set: SetFn): AISlice {
    return {
        ...AI_INITIAL_STATE,
        setAIEnabled: (enabled) =>
            set((state) => {
                const nextAI = { ...state.ai, enabled }
                return { ai: nextAI }
            }),
        setAISelectedModelId: (selectedModelId) =>
            set((state) => {
                const nextAI = { ...state.ai, selectedModelId }
                return { ai: nextAI }
            }),
        setAIWorkspaceSelectedModelId: (workspaceSelectedModelId) =>
            set((state) => ({
                ai: { ...state.ai, workspaceSelectedModelId },
            })),
        setAIWorkspaceReasoningLevel: (workspaceReasoningLevel) =>
            set((state) => ({
                ai: { ...state.ai, workspaceReasoningLevel },
            })),
        saveAICustomConfig: ({ protocol, baseURL, apiKey, modelOptions }) =>
            set((state) => {
                const normalizedModelOptions = normalizeAIModelOptions(modelOptions)
                const normalizedBaseURL = protocol === 'openai'
                    ? normalizeAIBaseURL(baseURL, DEFAULT_OPENAI_BASE_URL)
                    : normalizeAIBaseURL(baseURL, DEFAULT_CLAUDE_BASE_URL)
                const normalizedApiKey = normalizeAIApiKey(apiKey)
                const nextAI = {
                    ...state.ai,
                    customProtocol: protocol,
                    customOpenAIBaseURL: protocol === 'openai' ? normalizedBaseURL : state.ai.customOpenAIBaseURL,
                    customClaudeBaseURL: protocol === 'claude' ? normalizedBaseURL : state.ai.customClaudeBaseURL,
                    customOpenAIApiKey: protocol === 'openai' ? normalizedApiKey : state.ai.customOpenAIApiKey,
                    customClaudeApiKey: protocol === 'claude' ? normalizedApiKey : state.ai.customClaudeApiKey,
                    customModelOptions: normalizedModelOptions,
                    selectedModelId: normalizedModelOptions[0]?.id ?? state.ai.selectedModelId,
                }

                return { ai: nextAI }
            }),
    }
}
