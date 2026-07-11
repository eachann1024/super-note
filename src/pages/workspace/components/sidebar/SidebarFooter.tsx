import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettings } from "@/stores/settings";
import { useSidebarView } from "@/stores/useSidebarView";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";

interface SidebarFooterProps {
  currentView: "pages" | "trash" | "outline";
  isSettingsOpen: boolean;
  hideTrash?: boolean;
  onSwitchToTrash: () => void;
  onOpenSettings: () => void;
}

export function SidebarFooter({
  currentView,
  isSettingsOpen,
  hideTrash = false,
  onSwitchToTrash,
  onOpenSettings,
}: SidebarFooterProps) {
  const theme = useSettings((s) => s.theme);
  const toggleDarkMode = useSettings((s) => s.toggleDarkMode);
  const toggleSidebarShortcut = useSettings(
    (s) => s.appShortcuts.toggleSidebar,
  );
  const sidebarCollapsed = useSidebarView((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useSidebarView(
    (s) => s.toggleSidebarCollapsed,
  );
  const toggleSidebarShortcutLabel = toggleSidebarShortcut
    ? formatShortcut(toggleSidebarShortcut)
    : "未设置";
  const isDark = useResolvedTheme(theme) === "dark";

  const btnClass =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground [&_svg]:block";
  const activeClass = "text-foreground bg-[var(--goose-interactive-selected)]";

  return (
    <div className="px-2 pb-0 pt-1 mt-auto bg-[hsl(var(--goose-shell-bg))] flex items-center justify-between">
      <div className="flex items-center gap-0.5">
        <TooltipProvider delayDuration={600}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(btnClass, sidebarCollapsed && activeClass)}
                aria-label="收起侧栏"
                aria-pressed={sidebarCollapsed}
                onClick={toggleSidebarCollapsed}
              >
                <LucideIcons.PanelLeft className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="flex items-center gap-2">
                <span>收起侧栏</span>
                <span className="text-[11px] text-muted-foreground">
                  {toggleSidebarShortcutLabel}
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {!hideTrash && (
          <button
            type="button"
            className={cn(
              btnClass,
              !isSettingsOpen && currentView === "trash" && activeClass,
            )}
            aria-label="垃圾箱"
            onClick={onSwitchToTrash}
          >
            <LucideIcons.Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className={cn(btnClass, isSettingsOpen && activeClass)}
          aria-label="设置"
          onClick={onOpenSettings}
        >
          <LucideIcons.Settings className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        className={cn(btnClass)}
        aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
        onClick={toggleDarkMode}
      >
        {isDark ? (
          <LucideIcons.Sun className="h-4 w-4" />
        ) : (
          <LucideIcons.Moon className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
