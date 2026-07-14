import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { X, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import {
  useQuickNote,
  buildQuickNoteDraftPage,
  getActiveDraftContent,
  clampQuickNoteZoom,
  QUICKNOTE_MIN_WIDTH,
  QUICKNOTE_MIN_HEIGHT,
  QUICKNOTE_ZOOM_STEP,
  type QuickNoteSlot,
} from "@/stores/useQuickNote";
import { EditorHostBridge } from "@/pages/workspace/components/editor-host/EditorHostBridge";
import { Editor, type EditorRef } from "@/components/editor/core/Editor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Toaster } from "@/components/ui/sonner";
import { quickNoteWindow } from "@/lib/utools/quickNoteWindow";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { QuickNoteSlotSwitcher } from "./QuickNoteSlotSwitcher";

const POSITION_POLL_MS = 120;
const POSITION_SETTLE_MS = 720;

/**
 * 速记小窗根组件（独立窗口进程）。
 *
 * 小窗是「草稿便签」：不直接对应一条真实笔记，编辑内容只落到草稿存储
 * （useQuickNote.drafts[activeSlot]），不写进 pages、不进笔记列表 / 搜索、不自动存盘成文件。
 * 用户点左上角「保存到笔记本」才把当前槽位草稿整体入库成一条真实笔记，随后清空该槽位。
 *
 * 支持 1–5 五个独立草稿槽位，各自持久化。切换槽位时重挂编辑器加载对应草稿。
 *
 * 复用主应用的编辑器内核：通过 <EditorHostBridge page={draftPage} onContentChangeOverride>
 * 注入草稿 page + 平台能力，再渲染 <Editor>。不渲染侧栏/标签栏/大纲——小窗只有编辑区。
 */
export function QuickNoteApp() {
  const editorRef = useRef<EditorRef>(null);

  const activeSlot = useQuickNote((s) => s.activeSlot);
  const drafts = useQuickNote((s) => s.drafts);
  const setActiveSlot = useQuickNote((s) => s.setActiveSlot);
  const setDraftContent = useQuickNote((s) => s.setDraftContent);
  const saveDraftToNotebook = useQuickNote((s) => s.saveDraftToNotebook);
  const setWindowSize = useQuickNote((s) => s.setWindowSize);
  const setWindowPosition = useQuickNote((s) => s.setWindowPosition);
  const setEditorZoom = useQuickNote((s) => s.setEditorZoom);

  // 编辑界面缩放（持久化：下次开窗沿用上次 Cmd +/- 的程度）。
  const zoom = useQuickNote((s) => s.editorZoom);

  // 草稿 page：基于当前槽位草稿现造。仅随 activeSlot 重建，避免编辑 onChange 回灌打断输入。
  const draftPage = useMemo(
    () => buildQuickNoteDraftPage(drafts[activeSlot] ?? null),
    // 有意只依赖 activeSlot：槽位内容变更由编辑器内部维护。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSlot],
  );

  // resize 抖动抑制：拖动边框期间标记，停下再持久化尺寸（见下方 resize effect）。
  const isResizingRef = useRef(false);
  const resizeSettleTimerRef = useRef<number | null>(null);

  // 草稿内容变更：写入「本编辑器实例绑定的槽位」。
  // 用 activeSlot 闭包锁定槽号，避免切换后旧实例尾随 onChange 串写到新槽。
  const onDraftChange = useMemo(() => {
    const boundSlot = activeSlot;
    return (content: BlockNoteContent) => {
      setDraftContent(content as never, boundSlot);
    };
  }, [activeSlot, setDraftContent]);

  const handleSwitchSlot = (slot: QuickNoteSlot) => {
    if (slot === useQuickNote.getState().activeSlot) return;
    setActiveSlot(slot);
    requestAnimationFrame(() => {
      editorRef.current?.editor?.focus?.();
    });
  };

  /** 关窗 / 收起前把当前位置写进 store + preload，保证下次 uTools 唤起仍在原处。 */
  const persistPlacementThenClose = () => {
    const x = window.screenX;
    const y = window.screenY;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      setWindowPosition(x, y);
      quickNoteWindow.persistPosition(x, y);
    }
    quickNoteWindow.close();
  };

  // 保存到笔记本：B 插件(standalone)→ redirect 回传 A 落库；A 插件 → 原本地落库。
  // 注：保存按钮当前已隐藏，此函数暂时无调用方，保留逻辑以便后续恢复。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSave = () => {
    const isStandalone =
      typeof window !== "undefined" && window.__GOOSE_QUICKNOTE_STANDALONE__ === true;

    if (isStandalone) {
      // B 插件：取最新草稿内容（getState() 绕过闭包，拿到 onChange 实时更新值）。
      const content = getActiveDraftContent(useQuickNote.getState());
      if (!content) {
        toast.info("便签是空的，没有需要保存的内容");
        return;
      }
      const ok = quickNoteWindow.redirectSaveToMainApp(content);
      if (ok) {
        toast.success("已发送到鹅的笔记");
        useQuickNote.getState().clearDraft();
        // 清空编辑器到空白便签：重置内容并聚焦。
        requestAnimationFrame(() => {
          editorRef.current?.editor?.replaceBlocks?.(
            editorRef.current.editor.document,
            buildQuickNoteDraftPage(null).content as never,
          );
          editorRef.current?.editor?.focus?.();
        });
      }
      return;
    }

    // A 插件（非 standalone）：原本地落库逻辑不变。
    const id = saveDraftToNotebook();
    if (id) {
      toast.success("已保存到笔记本");
    } else {
      toast.info("便签是空的，没有需要保存的内容");
    }
    // 清空编辑器到空白便签：重置内容并聚焦。
    requestAnimationFrame(() => {
      editorRef.current?.editor?.replaceBlocks?.(
        editorRef.current.editor.document,
        buildQuickNoteDraftPage(null).content as never,
      );
      editorRef.current?.editor?.focus?.();
    });
  };

  // 首帧：聚焦光标到编辑器。
  useEffect(() => {
    requestAnimationFrame(() => editorRef.current?.editor?.focus?.());
  }, []);

  // 复用窗口：父窗以「速记」再次唤起已存在的小窗时（preload 发 quicknote:enter），
  // 重新聚焦即可（草稿延续，不重解析笔记）。
  useEffect(() => {
    const handler = () => {
      requestAnimationFrame(() => editorRef.current?.editor?.focus?.());
    };
    window.addEventListener("goose-note:quicknote-enter", handler);
    return () =>
      window.removeEventListener("goose-note:quicknote-enter", handler);
  }, []);
  // 强制置顶（无失焦自动隐藏）：小窗常驻最前层，置顶由主窗 preload 在创建时设定，
  // 失焦不再触发隐藏——点窗外不会收起，只能 Esc / 关闭按钮收起。

  // 键盘：Esc 收起；Cmd +/- 缩放编辑界面（Cmd+0 复位）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        const x = window.screenX;
        const y = window.screenY;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          setWindowPosition(x, y);
          quickNoteWindow.persistPosition(x, y);
        }
        quickNoteWindow.close();
        return;
      }
      // 仅在按下 Cmd（macOS）/ Ctrl 时处理缩放。
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setEditorZoom(
          clampQuickNoteZoom(
            useQuickNote.getState().editorZoom + QUICKNOTE_ZOOM_STEP,
          ),
        );
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setEditorZoom(
          clampQuickNoteZoom(
            useQuickNote.getState().editorZoom - QUICKNOTE_ZOOM_STEP,
          ),
        );
      } else if (e.key === "0") {
        e.preventDefault();
        setEditorZoom(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setEditorZoom, setWindowPosition]);

  // 窗口位置记忆：用户拖动窗口移动 → 停下后记住最终位置，下次开窗沿用。
  // 轮询间隔必须短于 settle 时间，否则拖动中会反复触发持久化 IPC，导致正文重绘抖动。
  useEffect(() => {
    let lastX = window.screenX;
    let lastY = window.screenY;
    let settleTimer: number | null = null;
    const poll = window.setInterval(() => {
      const x = window.screenX;
      const y = window.screenY;
      if (x === lastX && y === lastY) return;
      lastX = x;
      lastY = y;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        const x = window.screenX;
        const y = window.screenY;
        // preload 权威写 db；store 同步一份，避免后续草稿 persist 用旧坐标盖掉位置。
        quickNoteWindow.persistPosition(x, y);
        setWindowPosition(x, y);
      }, POSITION_SETTLE_MS);
    }, POSITION_POLL_MS);
    return () => {
      window.clearInterval(poll);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, [setWindowPosition]);

  // 窗口尺寸记忆：用户拖动窗口边框改宽高 → 停下后记住最终尺寸，下次开窗沿用。
  useEffect(() => {
    const onResize = () => {
      isResizingRef.current = true;
      if (resizeSettleTimerRef.current !== null) {
        window.clearTimeout(resizeSettleTimerRef.current);
      }
      resizeSettleTimerRef.current = window.setTimeout(() => {
        resizeSettleTimerRef.current = null;
        isResizingRef.current = false;
        // 持久化由主窗用 win.getSize() 权威读取后写回 dbStorage：子窗渲染进程的
        // outerWidth 在 uTools frameless 窗口里 resize 后并不更新，直接存会记错值，
        // 导致下次开窗仍回默认宽度（用户每次都要重新拉宽）。
        quickNoteWindow.persistSize();
        // 同步进程内 store（best-effort），用视口宽高兜底，开窗尺寸以 dbStorage 为准。
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w >= QUICKNOTE_MIN_WIDTH && h >= QUICKNOTE_MIN_HEIGHT) {
          setWindowSize(w, h);
        }
      }, 240);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (resizeSettleTimerRef.current !== null) {
        window.clearTimeout(resizeSettleTimerRef.current);
        resizeSettleTimerRef.current = null;
      }
      window.removeEventListener("resize", onResize);
    };
  }, [setWindowSize]);

  const headerBar = (
    <div
      className="quicknote-titlebar flex h-9 items-center justify-between gap-1 px-2"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      <div className="flex items-center gap-1">
        {/* 保存按钮暂时隐藏（保留 handleSave 逻辑，后续可恢复）。 */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="使用说明"
              title="使用说明"
              className="quicknote-titlebar-btn flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            className="w-72 text-xs leading-relaxed"
          >
            <div className="mb-1.5 text-sm font-medium">速记便签 · 用法</div>
            <ul className="space-y-1.5 text-muted-foreground">
              <li>
                <b className="text-foreground">草稿模式</b>
                ：这里写的内容是临时草稿，不会自动成为笔记，也不写入文件。
              </li>
              <li>
                <b className="text-foreground">多便签</b>
                ：顶栏中间 1–5 可切换五个独立草稿，各自单独保存；默认只显示当前编号，悬停展开全部。
              </li>
              <li>
                <b className="text-foreground">始终置顶</b>
                ：小窗常驻最前层，点击窗外也不会自动隐藏。
              </li>
              <li>
                <b className="text-foreground">缩放</b>
                ：⌘ + / ⌘ - 放大缩小编辑界面，⌘ 0 复位；缩放程度会记住，下次打开仍保持。
              </li>
              <li>
                <b className="text-foreground">收起</b>
                ：Esc 或点击右上角 <X className="inline h-3 w-3 align-text-bottom" /> 收起，再次呼出草稿仍在。
              </li>
              <li>
                <b className="text-foreground">位置 / 尺寸记忆</b>
                ：弹窗在屏幕上的位置、窗口宽高都会被记住，下次从 uTools 唤起仍在原处打开。
              </li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {/* 绝对居中，避免左右按钮宽度差导致视觉偏移 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-9 items-center justify-center">
        <div className="pointer-events-auto">
          <QuickNoteSlotSwitcher
            activeSlot={activeSlot}
            onChange={handleSwitchSlot}
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="关闭"
          className="quicknote-titlebar-btn flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          onClick={() => persistPlacementThenClose()}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="quicknote-root relative flex h-screen w-screen flex-col bg-[hsl(var(--goose-editor-bg))]">
      {headerBar}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto page-scroll-container">
        <EditorHostBridge
          key={activeSlot}
          page={draftPage}
          isEditorFullWidth
          onContentChangeOverride={onDraftChange}
        >
          {/*
            用 CSS zoom（Chromium/uTools 支持）而不是 transform:scale + 反向宽高。
            transform 不改变布局盒：缩小后 width=100/zoom% 会 > 100%，父级
            overflow-y-auto 会连带出现底部横向滚动条，放大时也会出现可视高度与
            scrollHeight 不一致。zoom 同步缩放布局与绘制，滚动条只随真实内容出现。
          */}
          <div
            className="quicknote-editor-surface flex min-h-full flex-col"
            style={{ zoom } as CSSProperties}
          >
            <Editor
              ref={editorRef}
              editable
              showSideMenu={false}
            />
          </div>
        </EditorHostBridge>
      </div>
      <Toaster
        className="quicknote-toaster"
        position="bottom-center"
        offset={{ bottom: 30, left: 24, right: 24 }}
        mobileOffset={{ bottom: 30, left: 24, right: 24 }}
        toastOptions={{
          classNames: {
            toast:
              "!min-w-0 !pr-10",
            // 不再覆盖 top：保留 sonner.tsx 默认的 !top-1/2 !-translate-y-1/2 垂直居中。
            closeButton: "!right-2.5",
          },
        }}
      />
    </div>
  );
}
