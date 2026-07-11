import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useHistoryView } from "@/stores/useHistoryView";
import { usePages } from "@/stores/usePages";
import { resolveHistoryBackend } from "@/lib/history/backend";
import {
  markMilestone,
  recordHistorySnapshot,
  unmarkMilestone,
} from "@/lib/history/snapshot";
import { materializeVersion } from "@/lib/history/restore";
import type { HistoryIndex, HistoryIndexEntry } from "@/lib/history/types";
import {
  createEditorSafeContent,
  extractBlockNoteTitle,
  normalizePageContent,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { editorSchema } from "@/components/editor/core/EditorComposer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HistoryReadOnlyEditor } from "./HistoryReadOnlyEditor";

const TRIGGER_LABEL: Record<HistoryIndexEntry["trigger"], string> = {
  idle: "自动",
  manual: "手动",
  "pre-op": "操作前",
};

type SelectedHistoryStatus = "idle" | "loading" | "ready" | "missing" | "error";

function triggerLabel(trigger: HistoryIndexEntry["trigger"]): string {
  return TRIGGER_LABEL[trigger] ?? "自动";
}

function createSafeHistoryContent(content: unknown): BlockNoteContent | null {
  try {
    return createEditorSafeContent(
      normalizePageContent(content as any),
      editorSchema,
    );
  } catch (error) {
    console.error("[history] normalize history content failed", error);
    return null;
  }
}

function formatGroupLabel(ts: number, now: number): string {
  const d1 = new Date(ts);
  const d2 = new Date(now);
  const day1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime();
  const day2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate()).getTime();
  const diffDays = Math.floor((day2 - day1) / (24 * 3600 * 1000));
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  return d1.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 历史模式的状态/行为共享层。
 * 所有三个布局插槽（VersionPane / Toolbar / Reader）通过这个 hook 拿到同一份数据。
 * 这样 WorkspaceLayout 可以把它们分别放到 Sidebar 右侧 / main 顶部 / main 编辑区，
 * 而不必再把版本列表塞进编辑区内部。
 */
function useHistoryViewLogic() {
  const active = useHistoryView((s) => s.active);
  const selectedVersionId = useHistoryView((s) => s.selectedVersionId);
  const refreshTick = useHistoryView((s) => s.refreshTick);
  const exit = useHistoryView((s) => s.exit);
  const select = useHistoryView((s) => s.select);
  const bumpRefresh = useHistoryView((s) => s.bumpRefresh);

  const { getPage, updatePage } = usePages();
  const pageId = active;
  const page = pageId ? getPage(pageId) : undefined;
  const pageTitle = page ? extractBlockNoteTitle(page.content) || "无标题" : "";

  const [index, setIndex] = useState<HistoryIndex | null>(null);
  const [selectedContent, setSelectedContent] = useState<BlockNoteContent | null>(null);
  const [selectedStatus, setSelectedStatus] =
    useState<SelectedHistoryStatus>("idle");

  // 加载版本索引
  useEffect(() => {
    if (!pageId) {
      setIndex(null);
      return;
    }
    let cancelled = false;
    const backend = resolveHistoryBackend(pageId);
    backend.loadIndex(pageId).then((idx) => {
      if (!cancelled) setIndex(idx);
    }).catch(() => {
      if (!cancelled) setIndex({ pageId, versions: [], lastVersionCharCount: 0 });
    });
    return () => { cancelled = true; };
  }, [pageId, refreshTick]);

  // 加载选中版本内容
  useEffect(() => {
    if (!pageId || !selectedVersionId) {
      setSelectedContent(null);
      setSelectedStatus("idle");
      return;
    }
    let cancelled = false;
    setSelectedContent(null);
    setSelectedStatus("loading");
    materializeVersion(pageId, selectedVersionId).then((result) => {
      if (cancelled) return;
      if (!result || result.content == null) {
        setSelectedContent(null);
        setSelectedStatus("missing");
        return;
      }
      const safeContent = createSafeHistoryContent(result.content);
      if (!safeContent) {
        setSelectedContent(null);
        setSelectedStatus("error");
        return;
      }
      setSelectedContent(safeContent);
      setSelectedStatus("ready");
    }).catch(() => {
      if (!cancelled) {
        setSelectedContent(null);
        setSelectedStatus("error");
      }
    });
    return () => { cancelled = true; };
  }, [pageId, selectedVersionId]);

  useEffect(() => {
    if (!index || index.versions.length === 0) return;
    if (selectedVersionId) {
      if (index.versions.some((v) => v.versionId === selectedVersionId)) return;
    }
    const sorted = [...index.versions].sort((a, b) => b.createdAt - a.createdAt);
    select(sorted[0].versionId);
  }, [index, selectedVersionId, select]);

  useEffect(() => {
    if (pageId && !page) {
      exit();
    }
  }, [pageId, page, exit]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        exit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [exit]);

  const groups = useMemo(() => {
    if (!index || index.versions.length === 0) return [];
    const sorted = [...index.versions].sort((a, b) => b.createdAt - a.createdAt);
    const now = Date.now();
    const result: { label: string; items: HistoryIndexEntry[] }[] = [];
    let currentLabel = "";
    for (const v of sorted) {
      const label = formatGroupLabel(v.createdAt, now);
      if (label !== currentLabel) {
        result.push({ label, items: [] });
        currentLabel = label;
      }
      result[result.length - 1].items.push(v);
    }
    return result;
  }, [index]);

  const selectedEntry = useMemo(
    () => index?.versions.find((v) => v.versionId === selectedVersionId) ?? null,
    [index, selectedVersionId],
  );

  const handleRestore = () => {
    if (!pageId || !selectedVersionId) return;
    const current = getPage(pageId);
    if (!current) return;
    const ok = window.confirm(
      "将当前内容覆盖为此版本？\n当前内容会自动保留为一次「操作前」快照，可随时撤回。",
    );
    if (!ok) return;

    try { flushEditorContent(true); } catch { /* ignore */ }

    const latest = getPage(pageId);
    if (!latest) return;

    recordHistorySnapshot({
      pageId,
      workspaceId: latest.workspaceId,
      content: latest.content,
      trigger: "pre-op",
    }).catch((err) => console.error("[history] pre-op snapshot failed:", err));

    materializeVersion(pageId, selectedVersionId).then((result) => {
      if (!result || result.content == null) {
        toast.error("无法读取该版本");
        return;
      }
      const safeContent = createSafeHistoryContent(result.content);
      if (!safeContent) {
        toast.error("该历史版本格式异常，无法还原");
        return;
      }
      const updates: Parameters<typeof updatePage>[1] = { content: safeContent };
      if (result.localFrontmatter !== undefined) {
        updates.localFrontmatter = result.localFrontmatter;
      }
      updatePage(pageId, updates);
      toast.success("已还原，当前内容已保留为「操作前」版本");
      exit();
    }).catch(() => {
      toast.error("无法读取该版本");
    });
  };

  const handleToggleMilestone = (versionId: string, willBe: boolean) => {
    if (!pageId) return;
    if (willBe) {
      markMilestone(pageId, versionId).then(() => {
        toast.success("已标记为里程碑");
        bumpRefresh();
      }).catch((err) => console.error("[history] markMilestone failed:", err));
    } else {
      unmarkMilestone(pageId, versionId).then(() => {
        bumpRefresh();
      }).catch((err) => console.error("[history] unmarkMilestone failed:", err));
    }
  };

  return {
    pageId,
    page,
    pageTitle,
    groups,
    isEmpty: groups.length === 0,
    selectedVersionId,
    selectedEntry,
    selectedContent,
    selectedStatus,
    exit,
    select,
    handleRestore,
    handleToggleMilestone,
  };
}

/**
 * 版本列表（嵌入 Sidebar 中段，临时替换页面树/大纲）。
 * 不自带宽度/背景/边框——靠 Sidebar 父容器提供（Sidebar 已是 shell-bg）。
 * 顶部带一个与 SidebarSectionHeader 同款节奏的小标题"页面历史"，
 * 退出按钮在主区 HistoryToolbar 上，这里不重复放。
 */
export function HistoryVersionList() {
  const {
    groups,
    isEmpty,
    selectedVersionId,
    select,
    handleToggleMilestone,
  } = useHistoryViewLogic();

  return (
    <div className="flex-1 min-h-0 flex flex-col" aria-label="历史版本列表">
      <div className="mt-1 shrink-0 px-3 py-2 flex items-center gap-1.5">
        <LucideIcons.History className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="text-[11px] text-muted-foreground/80 font-medium">
          页面历史
        </span>
      </div>
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <LucideIcons.History className="h-10 w-10 text-muted-foreground/20" />
          <p className="text-xs text-muted-foreground/60">暂无历史版本</p>
          <p className="text-[11px] text-muted-foreground/40 leading-relaxed">
            停笔 15 秒或心跳 30 秒自动保存
            <br />
            仅空白/换行变化不计入
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="py-2">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider px-3 py-1.5">
                  {group.label}
                </div>
                <div className="px-2 flex flex-col gap-0.5">
                  {group.items.map((v) => {
                    const isSelected = selectedVersionId === v.versionId;
                    const delta = v.charDelta;
                    const deltaText =
                      delta === 0 ? null : delta > 0 ? `+${delta}` : `${delta}`;
                    return (
                      <div
                        key={v.versionId}
                        role="button"
                        tabIndex={0}
                        onClick={() => select(v.versionId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            select(v.versionId);
                          }
                        }}
                        className={cn(
                          "w-full text-left rounded-[10px] px-3 py-2 transition-colors duration-150 cursor-pointer group",
                          isSelected
                            ? "bg-[hsl(var(--goose-selected-bg))]"
                            : "hover:bg-[hsl(var(--goose-selected-bg))]/60",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs">{formatTime(v.createdAt)}</span>
                            {v.label && (
                              <span className="text-[11px] text-muted-foreground/70 truncate">
                                {v.label}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {deltaText && (
                              <span
                                className={
                                  delta > 0
                                    ? "text-[10px] text-foreground/60"
                                    : "text-[10px] text-muted-foreground/50"
                                }
                              >
                                {deltaText}
                              </span>
                            )}
                            {v.isMilestone && (
                              <LucideIcons.Pin className="h-3 w-3 text-foreground/70" />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] text-muted-foreground/50">
                            {triggerLabel(v.trigger)} · {v.charCount} 字
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={v.isMilestone ? "取消里程碑" : "标记里程碑"}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleMilestone(v.versionId, !v.isMilestone);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.stopPropagation();
                                e.preventDefault();
                                handleToggleMilestone(v.versionId, !v.isMilestone);
                              }
                            }}
                            className="text-[10px] text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground cursor-pointer select-none"
                          >
                            {v.isMilestone ? "取消" : "标记"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="h-4" />
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/**
 * 历史模式顶栏：替代 PageHeader。
 * 高度 h-11 与 PageHeader 节奏对齐。
 */
export function HistoryToolbar() {
  const {
    pageTitle,
    selectedEntry,
    selectedVersionId,
    selectedStatus,
    exit,
    handleRestore,
  } = useHistoryViewLogic();

  return (
    <header className="h-11 px-3 flex items-center gap-3 border-b border-border/50 shrink-0 bg-[hsl(var(--goose-shell-bg))]">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={exit}
      >
        <LucideIcons.ArrowLeft className="h-3.5 w-3.5" />
        返回
      </Button>

      <div className="flex items-center gap-2 min-w-0 flex-1">
        <LucideIcons.History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground/70 shrink-0">历史 ·</span>
        <span className="text-sm font-medium truncate">{pageTitle}</span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {selectedEntry && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
            <span className="hidden md:inline">
              {new Date(selectedEntry.createdAt).toLocaleString("zh-CN")}
            </span>
            <span className="px-1.5 py-0.5 rounded-[10px] bg-[hsl(var(--goose-selected-bg))] text-foreground/60">
              {triggerLabel(selectedEntry.trigger)}
            </span>
            {selectedEntry.charDelta !== 0 && (
              <span
                className={
                  selectedEntry.charDelta > 0
                    ? "text-foreground/60"
                    : "text-muted-foreground/50"
                }
              >
                {selectedEntry.charDelta > 0 ? "+" : ""}
                {selectedEntry.charDelta}
              </span>
            )}
          </div>
        )}
          <Button
            size="sm"
            className="h-7 px-3 text-xs"
            disabled={!selectedVersionId || selectedStatus !== "ready"}
            onClick={handleRestore}
          >
          还原此版本
        </Button>
      </div>
    </header>
  );
}

function HistoryReaderState({
  icon: Icon,
  title,
  description,
  spinning = false,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  spinning?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="h-full min-h-[280px] flex items-center justify-center px-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--goose-interactive-hover)] text-muted-foreground">
          <Icon
            className={cn("h-5 w-5", spinning && "animate-spin")}
            strokeWidth={1.75}
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

/**
 * 主区只读编辑器。挂在 workspace-editor-surface > page-scroll-container 内，
 * 复用与主 Editor 完全一致的滚动容器和 max-w-4xl 包裹。
 */
export function HistoryReader() {
  const {
    selectedContent,
    selectedVersionId,
    selectedStatus,
    isEmpty,
  } = useHistoryViewLogic();

  if (selectedStatus === "loading") {
    return (
      <HistoryReaderState
        icon={LucideIcons.LoaderCircle}
        title="正在读取历史版本"
        description="稍等片刻，正在准备只读预览。"
        spinning
      />
    );
  }

  if (isEmpty) {
    return (
      <HistoryReaderState
        icon={LucideIcons.History}
        title="暂无历史版本"
        description="停笔一段时间后，鹅的笔记会自动保存可回看的历史。"
      />
    );
  }

  if (selectedStatus === "missing") {
    return (
      <HistoryReaderState
        icon={LucideIcons.FileQuestion}
        title="此历史版本不可读取"
        description="这条历史索引还在，但对应版本内容可能已被旧版数据或外部清理移除。"
      />
    );
  }

  if (selectedStatus === "error") {
    return (
      <HistoryReaderState
        icon={LucideIcons.FileWarning}
        title="此历史版本格式异常"
        description="这条记录可能来自旧版格式或包含脏数据，已跳过渲染以避免白屏。"
      />
    );
  }

  if (!(selectedContent && selectedVersionId)) {
    return (
      <HistoryReaderState
        icon={LucideIcons.MousePointerClick}
        title="选择一个历史版本"
        description="从左侧列表选择时间点后，这里会显示只读预览。"
      />
    );
  }

  return (
    <ErrorBoundary
      resetKey={selectedVersionId}
      fallback={(_, reset) => (
        <HistoryReaderState
          icon={LucideIcons.FileWarning}
          title="此历史版本渲染失败"
          description="已阻止历史视图白屏。可以重试，或切换左侧其他历史版本。"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 h-8 gap-1.5 rounded-[10px] text-xs"
              onClick={reset}
            >
              <LucideIcons.RotateCcw className="h-3.5 w-3.5" />
              重试
            </Button>
          }
        />
      )}
    >
      <HistoryReadOnlyEditor
        content={selectedContent}
        versionKey={selectedVersionId}
      />
    </ErrorBoundary>
  );
}
