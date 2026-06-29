import { FontSelector } from "@/pages/workspace/components/shared/FontSelector";
import { ImageExportThemeSelector } from "@/components/ui/image-export-theme-selector";
import { useState } from "react";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { CardThemeId, WatermarkConfig } from "@/lib/imageExport";
import { exportPageToImage, exportSelectionToImage } from "@/lib/imageExport";
import { extractBlockNoteTitle } from "@/components/editor/utils/blocknote-content";
import { useHistoryView } from "@/stores/useHistoryView";
import { deletePageWithUndo } from "@/lib/page-delete-actions";

function getEditorSelectedBlocks(): BlockNoteContent {
  try {
    const editor = (window as any).__gooseNoteEditor;
    if (editor && typeof editor.getSelection === "function") {
      const $from = editor.prosemirrorState.selection.$from;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "blockContainer") {
          const sel = editor.getSelection();
          if (Array.isArray(sel?.blocks)) return sel.blocks as BlockNoteContent;
          break;
        }
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function PageMenu() {
  const {
    activePageId,
    getPage,
    updatePage,
    createPage,
    setActivePage,
  } = usePages();
  const { activeNotebookId, notebooks, updateNotebook } = useNotebooks();
  const { globalEditorFullWidth } = useSettings();
  const page = activePageId ? getPage(activePageId) : undefined;
  const notebook = page ? notebooks[page.workspaceId] : undefined;
  const [themeSelectorOpen, setThemeSelectorOpen] = useState(false);
  const [selectedBlocks, setSelectedBlocks] = useState<BlockNoteContent>([]);

  const handleImport = async () => {
    const result = await importFile();
    if (result.success) {
      const newId = createPage(undefined, activeNotebookId || DEFAULT_NOTEBOOK);

      const content = result.content;
      const blocks = [
        { type: "heading", props: { level: 1 }, content: result.title },
        ...content,
      ] as any[];

      updatePage(newId, { content: blocks });

      setActivePage(null);
      requestAnimationFrame(() => {
        setActivePage(newId);
      });
    } else {
      console.error("导入失败:", result.error);
    }
  };

  const handleThemeConfirm = (themeId: CardThemeId, watermarkConfig: WatermarkConfig) => {
    if (!page) return;
    const blocks = getEditorSelectedBlocks();
    if (blocks.length > 0) {
      exportSelectionToImage(blocks, extractBlockNoteTitle(page.content) || "选中内容", themeId, watermarkConfig);
    } else {
      exportPageToImage(page, themeId, watermarkConfig);
    }
  };

  if (!page || !activePageId) return null;

  return (
    <>
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          const blocks = getEditorSelectedBlocks();
          setSelectedBlocks(blocks);
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="更多操作"
          className="h-8 w-8 rounded-[8px] text-muted-foreground/70 transition-colors duration-150 hover:bg-muted/65 hover:text-foreground"
        >
          <LucideIcons.MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">更多操作</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[280px] p-2" align="end" forceMount>
        {/* Font Selector */}
        <div className="px-1 py-2">
          <FontSelector
            value={page.fontFamily}
            onChange={(fontFamily) => updatePage(activePageId, { fontFamily })}
          />
        </div>

        <DropdownMenuGroup>
          <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-[10px] px-2 py-1.5 text-xs">
            <LucideIcons.Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">锁定页面</span>
            <Switch
              checked={page.isLocked}
              onCheckedChange={(checked) =>
                updatePage(activePageId, { isLocked: checked })
              }
            />
          </div>
        </DropdownMenuGroup>

        {/* Switches Section */}
        <DropdownMenuGroup>
          <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-[10px] px-2 py-1.5 text-xs">
            <LucideIcons.ArrowLeftRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">全宽显示（当前记事本）</span>
            <Switch
              checked={Boolean(notebook?.editorFullWidth ?? globalEditorFullWidth)}
              onCheckedChange={(checked) => {
                if (!notebook) return;
                updateNotebook(notebook.id, { editorFullWidth: checked });
              }}
            />
          </div>

          <DropdownMenuItem
            className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs text-foreground/85 dark:text-foreground/85 data-[highlighted]:text-[var(--goose-color-danger-focus)] focus:text-[var(--goose-color-danger-focus)]"
            onClick={() => void deletePageWithUndo(activePageId)}
          >
            <LucideIcons.Trash2 className="h-3.5 w-3.5" />
            <span className="min-w-0 truncate">移至垃圾箱</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        {/* Import */}
        <DropdownMenuGroup>
          <DropdownMenuItem className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs" onSelect={handleImport}>
            <LucideIcons.Upload className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="min-w-0 truncate">导入</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        {/* Generate Image — standalone, before Export */}
        <DropdownMenuItem
          className="page-menu-generate-image grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-2 text-xs text-foreground"
          onSelect={() => {
            setSelectedBlocks(getEditorSelectedBlocks());
            setThemeSelectorOpen(true);
          }}
        >
          <LucideIcons.Image className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="page-menu-shimmer-text min-w-0 truncate font-medium text-foreground">
            {selectedBlocks.length > 0 ? "生成选中图片" : "生成图片"}
          </span>
          <span className="text-[10px] font-normal text-muted-foreground/70">
            {selectedBlocks.length > 0 ? "选中" : "可选中生成"}
          </span>
        </DropdownMenuItem>

        {/* Export submenu */}
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 text-xs">
              <LucideIcons.Download className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 truncate">导出</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[160px]">
              <DropdownMenuItem
                className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs"
                onSelect={() => exportToJSON(page)}
              >
                <LucideIcons.FileJson className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 truncate">JSON</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs"
                onSelect={() => {
                  void exportToMarkdown(page).catch((e) => {
                    console.error("[export] Markdown 失败:", e);
                  });
                }}
              >
                <LucideIcons.FileCode className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 truncate">Markdown</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs"
                onSelect={() => {
                  void exportToHTML(page).catch((e) => {
                    console.error("[export] HTML 失败:", e);
                  });
                }}
              >
                <LucideIcons.FileType className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 truncate">HTML</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs"
                onSelect={() => {
                  void exportToPDF(page).catch((e) => {
                    console.error("[export] PDF 失败:", e);
                  });
                }}
              >
                <LucideIcons.FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 truncate">PDF</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem
            className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 text-xs"
            onSelect={() => {
              const pid = activePageId;
              // 进入历史模式前 flush，避免 200ms debounce 内的最新编辑丢失
              try { flushEditorContent(true); } catch { /* ignore */ }
              setTimeout(() => {
                useHistoryView.getState().enter(pid);
              }, 80);
            }}
          >
            <LucideIcons.History className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="min-w-0 truncate">页面历史</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2">
              <span aria-hidden="true" />
              <span>字数</span>
              <span className="text-[10px] opacity-80">{countWords(page.content)}</span>
            </div>
            <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2">
              <span aria-hidden="true" />
              <div className="flex flex-col gap-0.5">
                <span>最后编辑于</span>
                <span className="text-[10px] opacity-80">
                  {new Date(page.updatedAt).toLocaleString("zh-CN")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>

    <ImageExportThemeSelector
      open={themeSelectorOpen}
      onOpenChange={setThemeSelectorOpen}
      onConfirm={handleThemeConfirm}
      mode={selectedBlocks.length > 0 ? "selection" : "page"}
    />
  </>);
}
