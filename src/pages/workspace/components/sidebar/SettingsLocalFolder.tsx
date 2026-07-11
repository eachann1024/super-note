import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LOCAL_FOLDER_EDITOR_CANDIDATES,
  LOCAL_FOLDER_FILE_MANAGER_CANDIDATES,
  LOCAL_FOLDER_TERMINAL_CANDIDATES,
  type LocalFolderOpenAppCandidate,
} from "@/lib/local-folder-open-apps";
import { shell } from "@/lib/utools/shell";
import * as LucideIcons from "lucide-react";
import { SettingsSectionCard } from "./settings/SettingsSectionCard";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { toast } from "sonner";

interface SettingsLocalFolderProps {
  localFolderFileManager: string;
  setLocalFolderFileManager: (value: string) => void;
  localFolderExternalEditor: string;
  setLocalFolderExternalEditor: (value: string) => void;
  localFolderTerminal: string;
  setLocalFolderTerminal: (value: string) => void;
  localFolderHiddenFolders: string[];
  setLocalFolderHiddenFolders: (folders: string[]) => void;
}

interface OpenAppFieldProps {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  value: string;
  onChange: (value: string) => void;
  defaultLabel: string;
  customPlaceholder: string;
  options: LocalFolderOpenAppCandidate[];
}

const SYSTEM_VALUE = "__system__";
const CUSTOM_VALUE = "__custom__";
const DEFAULT_HIDDEN_FOLDERS = ["assets"];

const SETTINGS_OPTION_ROW_CLASS =
  "rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]";

function getSystemDefaultLabels() {
  const platform = navigator.platform || navigator.userAgent;
  if (/Win/i.test(platform)) {
    return {
      fileManager: "系统默认（资源管理器）",
      terminal: "系统默认（命令提示符）",
    };
  }
  if (/Mac/i.test(platform)) {
    return {
      fileManager: "系统默认（访达）",
      terminal: "系统默认（终端）",
    };
  }
  return {
    fileManager: "系统默认（文件管理器）",
    terminal: "系统默认（终端）",
  };
}

function OpenAppField({
  id,
  title,
  description,
  icon: Icon,
  value,
  onChange,
  defaultLabel,
  customPlaceholder,
  options,
}: OpenAppFieldProps) {
  const trimmedValue = value.trim();
  const matchedOption = useMemo(
    () => options.find((option) => option.appName === trimmedValue),
    [options, trimmedValue],
  );
  const isCustomValue = Boolean(trimmedValue && !matchedOption);
  const [customActive, setCustomActive] = useState(isCustomValue);

  useEffect(() => {
    if (isCustomValue) {
      setCustomActive(true);
      return;
    }
    if (trimmedValue && matchedOption) {
      setCustomActive(false);
    }
  }, [isCustomValue, matchedOption, trimmedValue]);

  const selectedValue = customActive && !trimmedValue
    ? CUSTOM_VALUE
    : !trimmedValue
      ? SYSTEM_VALUE
      : matchedOption?.appName ?? CUSTOM_VALUE;
  const selectedLabel = customActive && !trimmedValue
    ? "自定义"
    : !trimmedValue
      ? defaultLabel
      : matchedOption?.label ?? trimmedValue;
  const showCustomInput = customActive || isCustomValue;

  const handleSelect = (nextValue: string) => {
    if (nextValue === SYSTEM_VALUE) {
      setCustomActive(false);
      onChange("");
      return;
    }
    if (nextValue === CUSTOM_VALUE) {
      setCustomActive(true);
      return;
    }
    setCustomActive(false);
    onChange(nextValue);
  };

  return (
    <div className={`space-y-3 p-4 ${SETTINGS_OPTION_ROW_CLASS}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <Label htmlFor={`${id}-custom`} className="cursor-pointer">
              {title}
            </Label>
          </div>
          <p className="mt-1 pl-7 text-xs text-muted-foreground">{description}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-9 min-w-36 max-w-56 shrink-0 items-center justify-between gap-2 rounded-[10px] bg-[hsl(var(--background))] px-3 text-left text-sm text-foreground shadow-[inset_0_0_0_1px_hsl(var(--input))] transition-colors hover:bg-[var(--goose-interactive-hover)] focus:bg-[var(--goose-interactive-selected)]"
            >
              <span className="truncate">{selectedLabel}</span>
              <LucideIcons.ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuRadioGroup value={selectedValue} onValueChange={handleSelect}>
              <DropdownMenuRadioItem value={SYSTEM_VALUE}>
                <span className="truncate">{defaultLabel}</span>
              </DropdownMenuRadioItem>
              {options.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.appName}>
                  <span className="truncate">{option.label}</span>
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value={CUSTOM_VALUE}>
                <span>自定义</span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showCustomInput && (
        <div className="pl-7">
          <Input
            id={`${id}-custom`}
            value={trimmedValue}
            onChange={(event) => onChange(event.target.value)}
            onBlur={(event) => onChange(event.target.value.trim())}
            placeholder={customPlaceholder}
            className="h-9 text-sm"
          />
        </div>
      )}
    </div>
  );
}

interface HiddenFoldersFieldProps {
  folders: string[];
  onChange: (folders: string[]) => void;
}

function HiddenFoldersField({ folders, onChange }: HiddenFoldersFieldProps) {
  const [inputValue, setInputValue] = useState("");

  const addFolder = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if (folders.includes(name)) return;
    onChange([...folders, name]);
    setInputValue("");
  };

  const removeFolder = (name: string) => {
    onChange(folders.filter((f) => f !== name));
  };

  const resetToDefault = () => {
    onChange([...DEFAULT_HIDDEN_FOLDERS]);
  };

  const isDefault = JSON.stringify(folders) === JSON.stringify(DEFAULT_HIDDEN_FOLDERS);

  return (
    <div className="space-y-3 p-4">
      <div>
        <div className="flex items-center gap-3">
          <LucideIcons.EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <Label htmlFor="local-folder-hidden-folder-input" className="cursor-pointer">
            隐藏文件夹
          </Label>
        </div>
        <p className="mt-1 pl-7 text-xs text-muted-foreground">
          这些文件夹不会显示在本地文件夹笔记本的侧边栏中。
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pl-7">
        {folders.length === 0 && (
          <span className="text-xs text-muted-foreground">未隐藏任何文件夹</span>
        )}
        {folders.map((folder) => {
          const isDefaultFolder = DEFAULT_HIDDEN_FOLDERS.includes(folder);
          return (
            <Badge
              key={folder}
              variant={isDefaultFolder ? "default" : "secondary"}
              className="gap-1 pr-1.5"
            >
              {folder}
              <button
                type="button"
                disabled={isDefaultFolder}
                onClick={() => removeFolder(folder)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-50 hover:bg-primary-foreground/20"
                aria-label={`移除 ${folder}`}
              >
                <LucideIcons.X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pl-7">
        <Input
          id="local-folder-hidden-folder-input"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addFolder(inputValue);
            }
          }}
          placeholder="如：obsidian"
          className="h-9 text-sm"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-9 shrink-0"
          onClick={() => addFolder(inputValue)}
        >
          添加
        </Button>
      </div>

      {!isDefault && (
        <div className="pl-7">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
            onClick={resetToDefault}
          >
            恢复默认
          </Button>
        </div>
      )}
    </div>
  );
}

export function SettingsLocalFolder({
  localFolderFileManager,
  setLocalFolderFileManager,
  localFolderExternalEditor,
  setLocalFolderExternalEditor,
  localFolderTerminal,
  setLocalFolderTerminal,
  localFolderHiddenFolders,
  setLocalFolderHiddenFolders,
}: SettingsLocalFolderProps) {
  const [fileManagerOptions, setFileManagerOptions] = useState<LocalFolderOpenAppCandidate[]>([]);
  const [editorOptions, setEditorOptions] = useState<LocalFolderOpenAppCandidate[]>([]);
  const [terminalOptions, setTerminalOptions] = useState<LocalFolderOpenAppCandidate[]>([]);
  const systemDefaultLabels = useMemo(() => getSystemDefaultLabels(), []);
  const hiddenFoldersRefreshNonceRef = useRef(0);

  const handleHiddenFoldersChange = (folders: string[]) => {
    setLocalFolderHiddenFolders(folders);
    const refreshNonce = ++hiddenFoldersRefreshNonceRef.current;

    void (async () => {
      try {
        // 重扫会替换 workspace 页面集合；先把编辑器最新内容推进保存队列并等待本地写盘，
        // 避免用户刚编辑完就修改隐藏目录时丢失未落盘内容。
        window.dispatchEvent(
          new CustomEvent("goose-note:flush-editor", {
            detail: { immediate: true },
          }),
        );
        await usePages.getState().flushPendingLocalSaves();
        if (refreshNonce !== hiddenFoldersRefreshNonceRef.current) return;

        const pagesState = usePages.getState();
        const notebookState = useNotebooks.getState();
        const loadedWorkspaceIds = new Set(
          Object.values(pagesState.pages).map((page) => page.workspaceId),
        );
        Object.entries(notebookState.localFolderLoadStates).forEach(
          ([notebookId, state]) => {
            if (state.status === "ready") loadedWorkspaceIds.add(notebookId);
          },
        );
        if (notebookState.activeNotebookId) {
          loadedWorkspaceIds.add(notebookState.activeNotebookId);
        }

        let skippedDirtyNotebook = false;
        for (const notebookId of loadedWorkspaceIds) {
          const notebook = notebookState.notebooks[notebookId];
          if (notebook?.source !== "local-folder" || !notebook.localPath) continue;

          const currentPages = usePages.getState();
          const hasDirtyPage = Object.entries(currentPages.dirtyLocalPageIds)
            .some(
              ([pageId, dirty]) =>
                dirty && currentPages.pages[pageId]?.workspaceId === notebookId,
            );
          if (hasDirtyPage) {
            skippedDirtyNotebook = true;
            continue;
          }

          await currentPages.loadLocalFolderPages(notebook.id, notebook.localPath);
        }

        if (skippedDirtyNotebook) {
          toast.warning("部分本地文件夹仍有未保存内容，已暂缓刷新隐藏目录");
        }
      } catch (error) {
        console.error("[settings] 刷新本地文件夹隐藏目录失败", error);
        toast.error("刷新隐藏目录失败", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };

  useEffect(() => {
    let cancelled = false;

    const loadAvailableApps = async () => {
      const [fileManagers, editors, terminals] = await Promise.all([
        shell.listAvailableOpenApps(LOCAL_FOLDER_FILE_MANAGER_CANDIDATES),
        shell.listAvailableOpenApps(LOCAL_FOLDER_EDITOR_CANDIDATES),
        shell.listAvailableOpenApps(LOCAL_FOLDER_TERMINAL_CANDIDATES),
      ]);

      if (cancelled) return;
      setFileManagerOptions(fileManagers.filter((item) => item.id !== "finder"));
      setEditorOptions(editors);
      setTerminalOptions(terminals.filter((item) => item.id !== "terminal"));
    };

    void loadAvailableApps();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-foreground">本地文件夹</h3>
        <p className="mt-1 text-sm text-muted-foreground">仅对本地文件夹类型的记事本生效。</p>
      </div>

      <SettingsSectionCard title="打开方式">
        <div className="space-y-3">
          <OpenAppField
            id="local-folder-file-manager"
            title="文件管理器"
            description="右键打开或显示本地文件时使用。"
            icon={LucideIcons.FolderOpen}
            value={localFolderFileManager}
            onChange={setLocalFolderFileManager}
            defaultLabel={systemDefaultLabels.fileManager}
            customPlaceholder="如：Path Finder"
            options={fileManagerOptions}
          />
          <OpenAppField
            id="local-folder-editor"
            title="编辑器"
            description="右键用外部应用打开文件或文件夹时使用。"
            icon={LucideIcons.SquarePen}
            value={localFolderExternalEditor}
            onChange={setLocalFolderExternalEditor}
            defaultLabel="系统默认"
            customPlaceholder="如：Cursor、Zed、code -r"
            options={editorOptions}
          />
          <OpenAppField
            id="local-folder-terminal"
            title="终端"
            description="右键在终端中打开目录时使用。"
            icon={LucideIcons.Terminal}
            value={localFolderTerminal}
            onChange={setLocalFolderTerminal}
            defaultLabel={systemDefaultLabels.terminal}
            customPlaceholder="如：Ghostty、iTerm、wezterm"
            options={terminalOptions}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="显示">
        <HiddenFoldersField
          folders={localFolderHiddenFolders}
          onChange={handleHiddenFoldersChange}
        />
      </SettingsSectionCard>
    </div>
  );
}
