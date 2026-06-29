import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { X, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import {
  useQuickNote,
  buildQuickNoteDraftPage,
  QUICKNOTE_MIN_WIDTH,
  QUICKNOTE_MIN_HEIGHT,
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

// 编辑界面缩放（Cmd +/-）范围与步进。
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.8;
const ZOOM_STEP = 0.1;

/**
 * 速记小窗根组件（独立窗口进程）。
 *
 * 小窗是「草稿便签」：不直接对应一条真实笔记，编辑内容只落到草稿存储（useQuickNote.draftContent），
 * 不写进 pages、不进笔记列表 / 搜索、不自动存盘成文件。用户点左上角「保存到笔记本」才把草稿
 * 整体入库成一条真实笔记，随后清空草稿、回到空白便签。
 *
 * 复用主应用的编辑器内核：通过 <EditorHostBridge page={draftPage} onContentChangeOverride>
 * 注入草稿 page + 平台能力，再渲染 <Editor>。不渲染侧栏/标签栏/大纲——小窗只有编辑区。
 */
export function QuickNoteApp() {
  const editorRef = useRef<EditorRef>(null);

  const draftContent = useQuickNote((s) => s.draftContent);
  const setDraftContent = useQuickNote((s) => s.setDraftContent);
  const saveDraftToNotebook = useQuickNote((s) => s.saveDraftToNotebook);
  const setWindowSize = useQuickNote((s) => s.setWindowSize);

  // 编辑界面缩放比例（会话态，Cmd +/- 调整）。
  const [zoom, setZoom] = useState(1);

  // 草稿 page：基于持久化的 draftContent 现造，作为编辑器初始内容。
  // 仅在首帧 / 进程内构造一次（key 随之固定），避免每次草稿落库 setState 重建编辑器。
  // draftContent 的后续变更由编辑器内部维护，不回灌——回灌会打断输入。
  const [draftPage] = useState(() => buildQuickNoteDraftPage(draftContent));

  // resize 抖动抑制：拖动边框期间标记，停下再持久化尺寸（见下方 resize effect）。
  const isResizingRef = useRef(false);
  const resizeSettleTimerRef = useRef<number | null>(null);

  // 草稿内容变更：写入草稿存储（持久化），不落 page、不进列表。
  const onDraftChange = (content: BlockNoteContent) => {
    setDraftContent(content as never);
  };

  // 保存到笔记本：B 插件(standalone)→ redirect 回传 A 落库；A 插件 → 原本地落库。
  // 注：保存按钮当前已隐藏，此函数暂时无调用方，保留逻辑以便后续恢复。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSave = () => {
    const isStandalone =
      typeof window !== "undefined" && window.__GOOSE_QUICKNOTE_STANDALONE__ === true;

    if (isStandalone) {
      // B 插件：取最新草稿内容（getState() 绕过闭包，拿到 onChange 实时更新值）。
      const content = useQuickNote.getState().draftContent;
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
  // 监听回车「保存并退出」快捷键事件
  useEffect(() => {
    const handleEnterSaveExit = () => {
      // 这里的 handleSave 在 render 时可能指向旧函数，但 handleSave 本身只消费 refs / getState，
      // 故闭包内直接调用总是能拿到最新状态。
      handleSave();
    };
    window.addEventListener("goose-note:enter-save-exit", handleEnterSaveExit);
    return () =>
      window.removeEventListener("goose-note:enter-save-exit", handleEnterSaveExit);
  }, []);

  // 强制置顶（无失焦自动隐藏）：小窗常驻最前层，置顶由主窗 preload 在创建时设定，
  // 失焦不再触发隐藏——点窗外不会收起，只能 Esc / 关闭按钮收起。

  // 键盘：Esc 收起；Cmd +/- 缩放编辑界面（Cmd+0 复位）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        quickNoteWindow.close();
        return;
      }
      // 仅在按下 Cmd（macOS）/ Ctrl 时处理缩放。
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));
      } else if (e.key === "0") {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 窗口位置记忆：用户拖动窗口移动 → 停下后记住最终位置，下次开窗沿用。
  // window 无原生 move 事件，故低频轮询 screenX/screenY；坐标变化即重置「停下」计时，
  // 停稳 280ms 后把当前屏幕坐标上报父窗持久化（移动不触发 resize，必须独立记忆）。
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
        quickNoteWindow.persistPosition(window.screenX, window.screenY);
      }, 280);
    }, 300);
    return () => {
      window.clearInterval(poll);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, []);

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

  const headerBar = useMemo(
    () => (
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
                  <b className="text-foreground">始终置顶</b>
                  ：小窗常驻最前层，点击窗外也不会自动隐藏。
                </li>
                <li>
                  <b className="text-foreground">缩放</b>
                  ：⌘ + / ⌘ - 放大缩小编辑界面，⌘ 0 复位。
                </li>
                <li>
                  <b className="text-foreground">收起</b>
                  ：Esc 或点击右上角 <X className="inline h-3 w-3 align-text-bottom" /> 收起，再次呼出草稿仍在。
                </li>
                <li>
                  <b className="text-foreground">位置 / 尺寸记忆</b>
                  ：移动窗口、拖动边框调整的位置与宽高都会被记住，下次按此打开。
                </li>
              </ul>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="关闭"
            className="quicknote-titlebar-btn flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            onClick={() => quickNoteWindow.close()}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    ),
    // 标题栏内容静态（按钮 onClick 闭包内只读 refs / store action，稳定），无依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="quicknote-root relative flex h-screen w-screen flex-col bg-[hsl(var(--goose-editor-bg))]">
      {headerBar}
      <div className="min-h-0 flex-1 overflow-y-auto page-scroll-container">
        <EditorHostBridge
          page={draftPage}
          isEditorFullWidth
          onContentChangeOverride={onDraftChange}
        >
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
