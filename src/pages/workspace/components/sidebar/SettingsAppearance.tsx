import type { CodeStyle } from "@/stores/useSettings";
import { SelectableCard } from "@/components/ui/selectable-card";
import { SettingsSectionCard } from "./settings/SettingsSectionCard";
import { DEFAULT_FONT_NAMES } from "@/lib/fontLoader";

interface SettingsAppearanceProps {
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  codeStyle: CodeStyle;
  setCodeStyle: (style: CodeStyle) => void;
  globalEditorFullWidth: boolean;
  setGlobalEditorFullWidth: (enabled: boolean) => void;
  tableEvenColumnWidth: boolean;
  setTableEvenColumnWidth: (enabled: boolean) => void;
  customFonts: Record<"default" | "serif" | "mono", { label: string | null; font: string | null }>;
  setCustomLabel: (type: "default" | "serif" | "mono", label: string | null) => void;
  setCustomFont: (type: "default" | "serif" | "mono", font: string | null) => void;
  uiFontSize: "small" | "normal";
  setUIFontSize: (size: "small" | "normal") => void;
  hideExpandArrows: boolean;
  setHideExpandArrows: (hidden: boolean) => void;
}

const codeStyles: { value: CodeStyle; label: string; description: string }[] = [
  { value: "github", label: "GitHub", description: "经典的开发者风格" },
  {
    value: "modern",
    label: "One Dark Pro",
    description: "流行的暗色开发者风格，浅色自动配对",
  },
  {
    value: "dracula",
    label: "Dracula",
    description: "暗色使用 Dracula，浅色搭配柔和亮色",
  },
  { value: "night", label: "Tokyo Night", description: "东京夜系风格，自动适配日夜" },
  { value: "nord", label: "Nord", description: "兼容旧版 Nord，深浅自动配对" },
];

const LEGACY_CODE_STYLE_DISPLAY_MAP: Partial<Record<CodeStyle, CodeStyle>> = {
  default: "github",
  "nord-light": "nord",
};

const defaultLabels = { default: "默认", serif: "衬线体", mono: "等宽体" };
const fontPlaceholders = {
  default: "例：PingFang SC",
  serif: "例：Songti SC",
  mono: "例：JetBrains Mono",
};
const fontPreviewText = {
  default: "字体预览 Font Preview：Project Notes v2.1, Weekly Plan, Design Review, Alpha Beta Gamma 0123456789",
  serif: "衬线预览 Serif Sample：山高水长，风物有信；Reading Journal, Chapter 08, Classic Typography 0123456789",
  mono: "Monospace Preview: const releaseTag = 'build_2026_Q1_rc07'; function renderPreview(){ return 'AaBbCc 0123456789'; }",
};

const APPEARANCE_OPTION_ROW_CLASS =
  "rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]";

const APPEARANCE_SWITCH_CLASS =
  "data-[state=unchecked]:bg-[hsl(var(--foreground)/0.12)]";

export function SettingsAppearance({
  theme,
  setTheme,
  codeStyle,
  setCodeStyle,
  globalEditorFullWidth,
  setGlobalEditorFullWidth,
  tableEvenColumnWidth,
  setTableEvenColumnWidth,
  customFonts,
  setCustomLabel,
  setCustomFont,
  uiFontSize,
  setUIFontSize,
  hideExpandArrows,
  setHideExpandArrows,
}: SettingsAppearanceProps) {
  const getFontPreview = (type: "default" | "serif" | "mono") =>
    customFonts[type].font || DEFAULT_FONT_NAMES[type];
  const primaryModifier = getPrimaryModifierKeyDisplay({ style: "symbol" });
  const displayedCodeStyle =
    LEGACY_CODE_STYLE_DISPLAY_MAP[codeStyle] ?? codeStyle;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-foreground">外观</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          自定义界面的外观和感觉。
        </p>
      </div>

      <SettingsSectionCard
        title="主题设置"
        description="选择深浅模式，并调整界面字体大小。"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LucideIcons.SunMoon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <Label htmlFor="dark-mode">深色模式</Label>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-[hsl(var(--goose-selected-bg)/0.76)] p-1">
            <TooltipProvider delayDuration={600}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="浅色模式"
                    className={cn(
                      "h-7 w-7 rounded-full transition-all duration-200",
                      theme === "light" && "bg-background shadow-sm",
                    )}
                    onClick={() => setTheme("light")}
                  >
                    <LucideIcons.Sun className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">浅色模式</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="深色模式"
                    className={cn(
                      "h-7 w-7 rounded-full transition-all duration-200",
                      theme === "dark" && "bg-background shadow-sm",
                    )}
                    onClick={() => setTheme("dark")}
                  >
                    <LucideIcons.Moon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">深色模式</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="跟随系统"
                    className={cn(
                      "h-7 w-7 rounded-full transition-all duration-200",
                      theme === "system" && "bg-background shadow-sm",
                    )}
                    onClick={() => setTheme("system")}
                  >
                    <LucideIcons.Laptop className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">跟随系统</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <div className={`flex items-center justify-between gap-4 p-4 ${APPEARANCE_OPTION_ROW_CLASS}`}>
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.ALargeSmall className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <Label>界面字体大小</Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              调整整体界面的文字大小；{primaryModifier} + / - / 0 会调整并保存编辑器字号。
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-[hsl(var(--goose-selected-bg)/0.76)] p-1">
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 rounded-full px-3 text-xs transition-all duration-200",
                uiFontSize === "small" && "bg-background shadow-sm",
              )}
              onClick={() => setUIFontSize("small")}
            >
              标准
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 rounded-full px-3 text-xs transition-all duration-200",
                uiFontSize === "normal" && "bg-background shadow-sm",
              )}
              onClick={() => setUIFontSize("normal")}
            >
              放大
            </Button>
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title="编辑器布局"
        description="你可以一键让所有记事本都使用更开阔的编辑宽度。"
      >
        <div className={`flex items-center justify-between gap-4 p-4 ${APPEARANCE_OPTION_ROW_CLASS}`}>
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.StretchHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <Label htmlFor="global-editor-full-width" className="cursor-pointer">
                全局默认全宽
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              让编辑区铺满整个宽度；每个记事本还可以单独覆盖这个默认值。
            </p>
          </div>
          <Switch
            id="global-editor-full-width"
            checked={globalEditorFullWidth}
            onCheckedChange={setGlobalEditorFullWidth}
            className={APPEARANCE_SWITCH_CLASS}
          />
        </div>
        <div className={`mt-3 flex items-center justify-between gap-4 p-4 ${APPEARANCE_OPTION_ROW_CLASS}`}>
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.Table2 className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <Label htmlFor="table-even-column-width" className="cursor-pointer">
                表格两端对齐
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              让表格撑满可用宽度，并按列数均分每列宽度，像 Notion 表格那样整齐。
            </p>
          </div>
          <Switch
            id="table-even-column-width"
            checked={tableEvenColumnWidth}
            onCheckedChange={setTableEvenColumnWidth}
            className={APPEARANCE_SWITCH_CLASS}
          />
        </div>
        <div className={`mt-3 flex items-center justify-between gap-4 p-4 ${APPEARANCE_OPTION_ROW_CLASS}`}>
          <div>
            <div className="flex items-center gap-3">
              <LucideIcons.ChevronsDownUp className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <Label htmlFor="hide-expand-arrows" className="cursor-pointer">
                隐藏展开箭头
              </Label>
            </div>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              侧栏不常驻小箭头；移到有子项的行上时，图标位会变成箭头，点击即可展开或收起。
            </p>
          </div>
          <Switch
            id="hide-expand-arrows"
            checked={hideExpandArrows}
            onCheckedChange={setHideExpandArrows}
            className={APPEARANCE_SWITCH_CLASS}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title={<span className="flex items-center gap-2"><LucideIcons.Code2 className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />主题与代码风格</span>}
        description="选择代码块的配色方案，深浅模式自动适配。"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {codeStyles.map((t) => (
            <SelectableCard
              key={t.value}
              selected={displayedCodeStyle === t.value}
              onClick={() => setCodeStyle(t.value)}
              className={cn(
                "flex items-center gap-3 rounded-[12px] border px-3 py-3 transition-all duration-200",
                displayedCodeStyle === t.value
                  ? "border-transparent bg-[var(--goose-interactive-selected)] text-foreground"
                  : "border-transparent bg-[hsl(var(--goose-selected-bg)/0.48)] hover:bg-[var(--goose-interactive-hover)] dark:bg-[hsl(var(--foreground)/0.08)]",
              )}
            >
              <LucideIcons.Code2 className="h-5 w-5 shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-muted-foreground">
                  {t.description}
                </div>
              </div>
            </SelectableCard>
          ))}
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title={<span className="flex items-center gap-2"><LucideIcons.Type className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />自定义字体</span>}
        description="填写系统已安装的字体名；留空则用默认字体。"
      >
        <div className="space-y-4">
          {(["default", "serif", "mono"] as const).map((type) => (
            <div
              key={type}
              className="grid grid-cols-1 items-center gap-3 md:grid-cols-[88px_200px_minmax(0,1fr)]"
            >
              <div className="flex items-center gap-1">
                <Input
                  value={customFonts[type].label || ""}
                  onChange={(e) => setCustomLabel(type, e.target.value || null)}
                  placeholder={defaultLabels[type]}
                  className="h-8 border-0 px-2 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              <div className="flex flex-1 items-center gap-2">
                <Input
                  value={customFonts[type].font || ""}
                  onChange={(e) => setCustomFont(type, e.target.value || null)}
                  placeholder={fontPlaceholders[type]}
                  className="h-8 w-[200px] border-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              <div
                className="flex h-8 min-w-0 items-center overflow-hidden rounded-md bg-[hsl(var(--goose-selected-bg)/0.58)] px-3 text-sm md:text-base"
                style={{
                  fontFamily: customFonts[type].font || getFontPreview(type),
                }}
              >
                <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {fontPreviewText[type]}
                </span>
              </div>
            </div>
          ))}
        </div>
      </SettingsSectionCard>
    </div>
  );
}
