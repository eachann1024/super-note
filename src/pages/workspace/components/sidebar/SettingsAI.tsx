import { useEffect, useState } from "react";
import * as LucideIcons from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AiGradientIcon } from "@/components/ui/ai-gradient-icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  fetchCustomAIModels,
  getStoredAIModelOptions,
  type AIModelOption,
  type CustomAIProtocol,
} from "@/lib/ai-provider";
import type { AISettings } from "@/stores/useSettings";
import { SettingsSectionCard } from "./settings/SettingsSectionCard";
import { cn } from "@/lib/utils";

interface SettingsAIProps {
  ai: AISettings;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  selectedModelId: string | null;
  setSelectedModelId: (modelId: string | null) => void;
  saveCustomConfig: (config: {
    protocol: CustomAIProtocol;
    baseURL: string;
    apiKey: string;
    modelOptions: AIModelOption[];
  }) => void;
}

const SETTINGS_OPTION_ROW_CLASS =
  "rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]";

const CUSTOM_PROTOCOL_OPTIONS: Array<{
  id: CustomAIProtocol;
  label: string;
  description: string;
}> = [
  {
    id: "openai",
    label: "OpenAI 兼容协议",
    description: "支持自定义 baseURL 与 API Key",
  },
  {
    id: "claude",
    label: "Claude 协议",
    description: "支持自定义 baseURL 与 API Key",
  },
];

const CUSTOM_AI_KEY_HINT = "请前往“设置 -> AI 助手 -> 自定义 AI”补充 API Key";

export function SettingsAI({
  ai,
  enabled,
  setEnabled,
  selectedModelId,
  setSelectedModelId,
  saveCustomConfig,
}: SettingsAIProps) {
  const [customProtocol, setCustomProtocol] = useState<CustomAIProtocol>(ai.customProtocol);
  const [customOpenAIBaseURL, setCustomOpenAIBaseURL] = useState(ai.customOpenAIBaseURL);
  const [customClaudeBaseURL, setCustomClaudeBaseURL] = useState(ai.customClaudeBaseURL);
  const [customOpenAIApiKey, setCustomOpenAIApiKey] = useState(ai.customOpenAIApiKey);
  const [customClaudeApiKey, setCustomClaudeApiKey] = useState(ai.customClaudeApiKey);
  const [savingCustomConfig, setSavingCustomConfig] = useState(false);
  const [customSaveError, setCustomSaveError] = useState<string | null>(null);

  const customModels = getStoredAIModelOptions(ai);

  useEffect(() => {
    setCustomProtocol(ai.customProtocol);
  }, [ai.customProtocol]);

  useEffect(() => {
    setCustomOpenAIBaseURL(ai.customOpenAIBaseURL);
  }, [ai.customOpenAIBaseURL]);

  useEffect(() => {
    setCustomClaudeBaseURL(ai.customClaudeBaseURL);
  }, [ai.customClaudeBaseURL]);

  useEffect(() => {
    setCustomOpenAIApiKey(ai.customOpenAIApiKey);
  }, [ai.customOpenAIApiKey]);

  useEffect(() => {
    setCustomClaudeApiKey(ai.customClaudeApiKey);
  }, [ai.customClaudeApiKey]);

  useEffect(() => {
    if (customModels.length === 0) {
      return;
    }

    if (!selectedModelId || !customModels.some((item) => item.id === selectedModelId)) {
      setSelectedModelId(customModels[0].id);
    }
  }, [customModels, selectedModelId, setSelectedModelId]);

  const currentModel = customModels.find((item) => item.id === selectedModelId) ?? null;
  const selectedProtocol = CUSTOM_PROTOCOL_OPTIONS.find((item) => item.id === customProtocol) ?? CUSTOM_PROTOCOL_OPTIONS[0];
  const customBaseURL = customProtocol === "openai" ? customOpenAIBaseURL : customClaudeBaseURL;
  const customApiKey = customProtocol === "openai" ? customOpenAIApiKey : customClaudeApiKey;
  const currentBaseURLPlaceholder = customProtocol === "openai" ? DEFAULT_OPENAI_BASE_URL : DEFAULT_CLAUDE_BASE_URL;

  const saveButtonReason = savingCustomConfig
    ? "正在保存并读取模型列表"
    : !customApiKey.trim()
      ? CUSTOM_AI_KEY_HINT
      : null;

  const modelButtonDisabled = !enabled || savingCustomConfig || customModels.length === 0;

  const modelButtonReason = !enabled
    ? "先打开 AI 助手开关后才能选择模型"
    : savingCustomConfig
      ? "模型列表读取中，请稍候"
      : customSaveError
        ? customSaveError
        : customModels.length === 0
          ? "请先填写并保存自定义 AI 配置"
          : null;

  const handleSaveCustomConfig = async () => {
    if (saveButtonReason) {
      toast.error(saveButtonReason);
      return;
    }

    setSavingCustomConfig(true);
    setCustomSaveError(null);

    try {
      const modelOptions = await fetchCustomAIModels({
        protocol: customProtocol,
        baseURL: customBaseURL,
        apiKey: customApiKey,
      });

      saveCustomConfig({
        protocol: customProtocol,
        baseURL: customBaseURL,
        apiKey: customApiKey,
        modelOptions,
      });

      if (modelOptions.length > 0) {
        setSelectedModelId(modelOptions[0].id);
      }
      toast.success("自定义 AI 已保存");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存自定义 AI 失败";
      setCustomSaveError(message);
      toast.error(message);
    } finally {
      setSavingCustomConfig(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-foreground">AI 助手</h3>
        <p className="mt-1 text-sm text-muted-foreground">管理 AI 入口、模型和空格唤起。</p>
      </div>

      <SettingsSectionCard
        title={<span className="flex items-center gap-2"><LucideIcons.Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />AI 开关</span>}
        description="开启后页头出现 AI 入口；空白段落按空格可唤起 AI。"
      >
        <div className={cn("flex items-center justify-between gap-4 p-4", SETTINGS_OPTION_ROW_CLASS)}>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <AiGradientIcon className="h-4 w-4" />
              <Label htmlFor="ai-enabled" className="cursor-pointer text-sm font-medium text-foreground">
                启用 AI 写作助手
              </Label>
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              关闭后页头不会显示 AI 图标，已打开的 AI 页面也会自动收起。
            </div>
          </div>
          <Switch id="ai-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title={<span className="flex items-center gap-2"><LucideIcons.Bot className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />自定义 AI</span>}
        description="接入你自己的 AI 服务。"
      >
        <div className="space-y-3">
          <div className="space-y-3">
              <div className={cn("flex items-center justify-between gap-4 p-4", SETTINGS_OPTION_ROW_CLASS)}>
                <div className="flex items-center gap-3">
                  <LucideIcons.Server className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-foreground">协议</Label>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="min-w-[220px] justify-between rounded-[10px]">
                      <span className="truncate">{selectedProtocol.label}</span>
                      <LucideIcons.ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[280px]">
                    <DropdownMenuRadioGroup
                      value={customProtocol}
                      onValueChange={(value) => {
                        setCustomSaveError(null);
                        setCustomProtocol(value as CustomAIProtocol);
                      }}
                    >
                      {CUSTOM_PROTOCOL_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem key={option.id} value={option.id} className="items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">{option.label}</div>
                            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {option.description}
                            </div>
                          </div>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className={cn("space-y-3 p-4", SETTINGS_OPTION_ROW_CLASS)}>
                <div className="flex items-center gap-3">
                  <LucideIcons.Globe className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <Label htmlFor="custom-ai-base-url" className="text-sm font-medium text-foreground">
                    Base URL
                  </Label>
                </div>
                <Input
                  id="custom-ai-base-url"
                  value={customBaseURL}
                  onChange={(event) => {
                    setCustomSaveError(null);
                    if (customProtocol === "openai") {
                      setCustomOpenAIBaseURL(event.target.value);
                      return;
                    }
                    setCustomClaudeBaseURL(event.target.value);
                  }}
                  placeholder={currentBaseURLPlaceholder}
                  autoComplete="off"
                />
              </div>

              <div className={cn("space-y-3 p-4", SETTINGS_OPTION_ROW_CLASS)}>
                <div className="flex items-center gap-3">
                  <LucideIcons.KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <Label htmlFor="custom-ai-api-key" className="text-sm font-medium text-foreground">
                    API Key
                  </Label>
                </div>
                <Input
                  id="custom-ai-api-key"
                  type="password"
                  value={customApiKey}
                  onChange={(event) => {
                    setCustomSaveError(null);
                    if (customProtocol === "openai") {
                      setCustomOpenAIApiKey(event.target.value);
                      return;
                    }
                    setCustomClaudeApiKey(event.target.value);
                  }}
                  placeholder="输入后点保存自动拉取模型"
                  autoComplete="off"
                />
              </div>

              <div className={cn("flex items-center justify-between gap-4 p-4", SETTINGS_OPTION_ROW_CLASS)}>
                <div className="flex items-center gap-3">
                  <LucideIcons.Download className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-foreground">保存配置</Label>
                    <p className="text-xs text-muted-foreground">保存后自动拉取该服务可用的模型列表。</p>
                  </div>
                </div>
                <TooltipProvider delayDuration={600}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={Boolean(saveButtonReason)}
                          onClick={() => {
                            void handleSaveCustomConfig();
                          }}
                          className={cn(Boolean(saveButtonReason) && "cursor-not-allowed")}
                        >
                          {savingCustomConfig ? "保存中..." : "保存"}
                        </Button>
                      </div>
                    </TooltipTrigger>
                    {saveButtonReason ? (
                      <TooltipContent side="left">{saveButtonReason}</TooltipContent>
                    ) : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title={<span className="flex items-center gap-2"><LucideIcons.Brain className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />AI 模型</span>}
        description="选择全局默认模型；笔记本 AI 如设置了工作区模型，会优先使用工作区模型。"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void handleSaveCustomConfig();
            }}
          >
            重新获取模型
          </Button>
        }
      >
        <div className="space-y-3">
          <div className={cn("flex items-center justify-between gap-4 p-4", SETTINGS_OPTION_ROW_CLASS)}>
            <div className="flex items-center gap-3">
              <LucideIcons.Cpu className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <div className="space-y-1">
                <Label className="text-sm font-medium text-foreground">默认模型</Label>
              </div>
            </div>
            <TooltipProvider delayDuration={600}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={modelButtonDisabled}
                          className={cn(
                            "min-w-[220px] justify-between rounded-[10px]",
                            modelButtonDisabled && "cursor-not-allowed",
                          )}
                        >
                          <span className="truncate">
                            {currentModel?.label ?? modelButtonReason ?? "请选择模型"}
                          </span>
                          <LucideIcons.ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-[280px]"
                        style={{ maxHeight: "min(360px, var(--radix-dropdown-menu-content-available-height))" }}
                      >
                        <DropdownMenuRadioGroup
                          value={selectedModelId ?? ""}
                          onValueChange={(value) => setSelectedModelId(value)}
                        >
                          {customModels.map((model) => (
                            <DropdownMenuRadioItem key={model.id} value={model.id} className="items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-foreground">{model.label}</div>
                                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                  {model.description || model.id}
                                </div>
                              </div>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TooltipTrigger>
                {modelButtonReason ? (
                  <TooltipContent side="left">{modelButtonReason}</TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </SettingsSectionCard>
    </div>
  );
}
