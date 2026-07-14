import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  uToolsStorage,
  readDbStorageJSON,
  writeDbStorageJSON,
} from "@/lib/storage";
import { usePages } from "@/stores/usePages";
import { useNotebooks, DEFAULT_NOTEBOOK } from "@/stores/useNotebooks";
import {
  createEmptyLocalPageContent,
} from "@/components/editor/utils/blocknote-content";
import type { JSONContent, Page } from "@/types";

/**
 * 速记小窗状态（独立窗口进程内使用）。
 *
 * 小窗与主窗是两个独立的 WebView 进程，但共享同一份 uTools db。小窗是「草稿便签」：
 * 不直接对应一条真实笔记，编辑内容只落到草稿存储，不写进 pages、不进笔记列表 / 搜索。
 * 用户点左上角「保存到笔记本」才把当前槽位草稿整体 createPageRecord 入库，
 * 随后清空该槽位、回到空白便签。
 *
 * 支持 1–5 五个独立草稿槽位（activeSlot + drafts），各自持久化、互不覆盖。
 * 另持久化 pinned、editorZoom、windowWidth/windowHeight、windowX/windowY。
 * 当前正在编辑的 draftPage 是会话态（基于当前槽位草稿现造），不持久化。
 */
export type QuickNoteSlot = 1 | 2 | 3 | 4 | 5;

export const QUICKNOTE_SLOT_COUNT = 5;
export const QUICKNOTE_SLOTS: readonly QuickNoteSlot[] = [1, 2, 3, 4, 5];

export type QuickNoteDrafts = Record<QuickNoteSlot, JSONContent | null>;

export function createEmptyQuickNoteDrafts(): QuickNoteDrafts {
  return { 1: null, 2: null, 3: null, 4: null, 5: null };
}

function normalizeSlot(value: unknown): QuickNoteSlot {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 2 || n === 3 || n === 4 || n === 5) return n;
  return 1;
}

function normalizeDrafts(raw: unknown, legacyDraft?: JSONContent | null): QuickNoteDrafts {
  const empty = createEmptyQuickNoteDrafts();
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, JSONContent | null>;
    for (const slot of QUICKNOTE_SLOTS) {
      const key = String(slot);
      if (key in rec) empty[slot] = rec[key] ?? null;
      else if (slot in (raw as object)) {
        empty[slot] = (raw as QuickNoteDrafts)[slot] ?? null;
      }
    }
    return empty;
  }
  // 旧版单草稿：迁移到槽位 1
  if (legacyDraft !== undefined) {
    empty[1] = legacyDraft ?? null;
  }
  return empty;
}

interface QuickNoteState {
  /** 当前激活的草稿槽位（1–5） */
  activeSlot: QuickNoteSlot;
  /** 五个独立草稿内容（各自持久化） */
  drafts: QuickNoteDrafts;
  /**
   * 是否置顶钉住。速记小窗强制置顶（产品决定，无取消入口），恒为 true。
   * 字段保留仅为持久化结构兼容；不再有切换 UI。
   */
  pinned: boolean;
  /** 记住的窗口宽度（持久化，下次开窗沿用；手动拖动后更新） */
  windowWidth: number;
  /** 记住的窗口高度（持久化，下次开窗沿用；手动拖动后更新） */
  windowHeight: number;
  /**
   * 记住的窗口左上角 x/y（持久化，下次开窗沿用）。
   * preload 用 win.getBounds() 权威写入 db；web 侧拖动停下 / 关窗时经 setWindowPosition
   * 同步进 store，避免后续草稿 persist 用旧坐标覆盖。
   */
  windowX?: number;
  windowY?: number;
  /**
   * 编辑界面缩放比例（Cmd +/- 调整，持久化；下次开窗沿用）。
   * 与窗口像素尺寸无关：只缩放编辑内容视觉大小。
   */
  editorZoom: number;
  /** 切换当前草稿槽位（不改其它槽位内容） */
  setActiveSlot: (slot: QuickNoteSlot) => void;
  /**
   * 草稿内容变更（编辑器 onContentChange 调用）。
   * 可显式指定 slot：切换槽位时旧编辑器卸载前的最后一次 onChange 仍写回原槽，避免串写。
   */
  setDraftContent: (content: JSONContent, slot?: QuickNoteSlot) => void;
  /**
   * 保存当前槽位草稿到笔记本：以草稿内容新建一条真实笔记并落库，随后清空该槽位。
   * 返回新笔记 id；草稿为空时返回 null（不产生空笔记）。
   */
  saveDraftToNotebook: () => string | null;
  /** 清空当前槽位草稿，回到空白便签。 */
  clearDraft: () => void;
  setWindowWidth: (width: number) => void;
  setWindowHeight: (height: number) => void;
  setWindowSize: (width: number, height: number) => void;
  /** 更新编辑界面缩放（持久化）。 */
  setEditorZoom: (zoom: number) => void;
  /**
   * 同步窗口屏幕坐标到 store（与 preload 权威写入配合）。
   * 子窗拖动停下后调用，避免后续 store persist 用旧/空坐标盖掉 preload 写的位置。
   */
  setWindowPosition: (x: number, y: number) => void;
}

/** 速记小窗默认宽度，与 preload QUICKNOTE_WIDTH 保持一致。 */
export const QUICKNOTE_DEFAULT_WIDTH = 480;
/** 速记小窗最小宽度，与 preload minWidth 保持一致。 */
export const QUICKNOTE_MIN_WIDTH = 320;
/** 速记小窗默认高度，与 preload QUICKNOTE_HEIGHT 保持一致。 */
export const QUICKNOTE_DEFAULT_HEIGHT = 350;
/** 速记小窗最小高度，与 preload QUICKNOTE_MIN_HEIGHT 保持一致。 */
export const QUICKNOTE_MIN_HEIGHT = 300;
/** 编辑界面缩放下限（Cmd -）。 */
export const QUICKNOTE_ZOOM_MIN = 0.7;
/** 编辑界面缩放上限（Cmd +）。 */
export const QUICKNOTE_ZOOM_MAX = 1.8;
/** 编辑界面缩放步进。 */
export const QUICKNOTE_ZOOM_STEP = 0.1;
/** 编辑界面默认缩放。 */
export const QUICKNOTE_ZOOM_DEFAULT = 1;

/** 把缩放值钳到合法范围，并四舍五入到 0.01，避免浮点漂移。 */
export function clampQuickNoteZoom(zoom: unknown): number {
  const n = typeof zoom === "number" ? zoom : Number(zoom);
  if (!Number.isFinite(n)) return QUICKNOTE_ZOOM_DEFAULT;
  const clamped = Math.min(QUICKNOTE_ZOOM_MAX, Math.max(QUICKNOTE_ZOOM_MIN, n));
  return Math.round(clamped * 100) / 100;
}

/** 判断草稿内容是否为空白（无任何可见文本）——避免保存出空笔记。 */
const isDraftEmpty = (content: JSONContent | null): boolean => {
  if (!content) return true;
  const text = JSON.stringify(content)
    .replace(/"type"|"text"|"content"|"styles"|"props"|"id"|"children"/g, "");
  // 粗判：内容里若不含任何中日韩 / 拉丁 / 数字字符，视为空白。
  return !/[\p{L}\p{N}]/u.test(text);
};

/** 读取当前激活槽位的草稿内容。 */
export function getActiveDraftContent(state: {
  activeSlot: QuickNoteSlot;
  drafts: QuickNoteDrafts;
}): JSONContent | null {
  return state.drafts[state.activeSlot] ?? null;
}

export const useQuickNote = create<QuickNoteState>()(
  persist(
    (set, get) => ({
      activeSlot: 1,
      drafts: createEmptyQuickNoteDrafts(),
      pinned: true, // 强制置顶，恒 true
      windowWidth: QUICKNOTE_DEFAULT_WIDTH,
      windowHeight: QUICKNOTE_DEFAULT_HEIGHT,
      windowX: undefined,
      windowY: undefined,
      editorZoom: QUICKNOTE_ZOOM_DEFAULT,

      setActiveSlot: (slot) => {
        const next = normalizeSlot(slot);
        if (next === get().activeSlot) return;
        set({ activeSlot: next });
      },

      setDraftContent: (content, slot) =>
        set((state) => {
          const target = slot != null ? normalizeSlot(slot) : state.activeSlot;
          return {
            drafts: { ...state.drafts, [target]: content },
          };
        }),

      saveDraftToNotebook: () => {
        const content = getActiveDraftContent(get());
        if (isDraftEmpty(content)) {
          get().clearDraft();
          return null;
        }
        const nbId =
          useNotebooks.getState().activeNotebookId ?? DEFAULT_NOTEBOOK;
        const id = usePages.getState().createPageRecord({
          workspaceId: nbId,
          content: content ?? undefined,
        });
        get().clearDraft();
        return id;
      },

      clearDraft: () =>
        set((state) => ({
          drafts: { ...state.drafts, [state.activeSlot]: null },
        })),

      setWindowWidth: (width) =>
        set({ windowWidth: Math.max(QUICKNOTE_MIN_WIDTH, Math.round(width)) }),
      setWindowHeight: (height) =>
        set({ windowHeight: Math.max(QUICKNOTE_MIN_HEIGHT, Math.round(height)) }),
      setWindowSize: (width, height) =>
        set({
          windowWidth: Math.max(QUICKNOTE_MIN_WIDTH, Math.round(width)),
          windowHeight: Math.max(QUICKNOTE_MIN_HEIGHT, Math.round(height)),
        }),

      setEditorZoom: (zoom: number) => set({ editorZoom: clampQuickNoteZoom(zoom) }),

      setWindowPosition: (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        set({ windowX: Math.round(x), windowY: Math.round(y) });
      },
    }),
    {
      name: "goose-note:quicknote",
      version: 1,
      storage: createJSONStorage(() => uToolsStorage),
      partialize: (state) => ({
        activeSlot: state.activeSlot,
        drafts: state.drafts,
        pinned: true, // 强制置顶，写回恒 true
        editorZoom: state.editorZoom,
        windowWidth: state.windowWidth,
        windowHeight: state.windowHeight,
        // 位置：preload 与 setWindowPosition 双写；这里必须始终带上 store 内最新
        // windowX/Y，否则草稿 onChange 触发的 persist 会用缺省/旧值把 preload 刚写的位置抹掉。
        windowX: state.windowX,
        windowY: state.windowY,
      }),
      migrate: (persisted, version) => {
        const raw = (persisted ?? {}) as Record<string, unknown>;
        if (version < 1) {
          // v0：单字段 draftContent → 槽位 1，其余空
          return {
            ...raw,
            activeSlot: 1,
            drafts: normalizeDrafts(undefined, (raw.draftContent as JSONContent | null) ?? null),
          };
        }
        return {
          ...raw,
          activeSlot: normalizeSlot(raw.activeSlot),
          drafts: normalizeDrafts(raw.drafts, (raw.draftContent as JSONContent | null) ?? null),
        };
      },
      // 兜底：缺 drafts / 脏 activeSlot 时仍能归一，避免 rehydrate 后崩溃
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...current,
          ...p,
          activeSlot: normalizeSlot(p.activeSlot ?? current.activeSlot),
          drafts: normalizeDrafts(
            p.drafts,
            (p.draftContent as JSONContent | null | undefined) ?? null,
          ),
          pinned: true,
        } as typeof current;
      },
      skipHydration: true,
    },
  ),
);

/**
 * 草稿是否为「空白单块」：null / 空数组 / 仅含一个无可见文本的块（如空段落、空标题）。
 * 用于把这类草稿归一成不带标题的空段落，覆盖存量脏数据（早期被强转的空 H1）。
 * 只看首块有无 inline 文本，不碰块类型 props——避免 isDraftEmpty 那种按 JSON 文本
 * 糊匹配、被 props 里 "default"/"left" 等拉丁字母值误判的问题。
 */
// 可承载 inline 文本、且空内容即视为「空白」的块类型。结构化块（image/table/
// codeBlock/file/video/audio…）不在此列：它们没有 inline content，内容在 props/rows 里，
// 单个结构化块是真实草稿，不能被当空白清掉。
const TEXTUAL_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "callout",
]);

const isBlankSingleBlockDraft = (content: JSONContent | null): boolean => {
  if (!content) return true;
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return true;
  if (content.length > 1) return false;
  const only = content[0] as {
    type?: string;
    content?: unknown;
    children?: unknown[];
  };
  if (Array.isArray(only.children) && only.children.length > 0) return false;
  // 仅对文本类块判空；结构化块一律保留（视为有内容）。
  if (!only.type || !TEXTUAL_BLOCK_TYPES.has(only.type)) return false;
  const inline = only.content;
  if (inline == null) return true; // 空段落/空标题：content 为 undefined
  if (typeof inline === "string") return inline.length === 0;
  if (Array.isArray(inline)) {
    return inline.every(
      (n) =>
        typeof (n as { text?: unknown })?.text !== "string" ||
        (n as { text: string }).text.length === 0,
    );
  }
  return false;
};

/**
 * 把草稿首块的 heading 降级为 paragraph（保留 inline 文字与通用排版属性，仅去掉 level）。
 *
 * 「小窗首块永远从正文起手、绝不是标题一」是产品红线（[[title-heading-is-sacred]] 的反面：
 * 主窗首块恒 H1，小窗首块恒非标题）。运行期路径（normalize/firstTitleGuard）已全部豁免草稿页，
 * 不会再主动把首块转 H1；但**存量持久化**里可能残留早期被强转的 H1 首块——用户在那个 H1 块里
 * 继续编辑，onChange 又原样存回 H1，形成「重开即标题1」的死循环（isBlankSingleBlockDraft 只清
 * 空白块、清不掉有内容的 H1）。这里在加载构造 draftPage 时一次性把首块掰回正文，打破循环。
 *
 * 只动**首块**、只把 **heading→paragraph**：第二行起的标题、其它块类型一律原样保留。
 */
function demoteFirstHeadingToParagraph(content: JSONContent): JSONContent {
  if (!Array.isArray(content) || content.length === 0) return content;
  const first = content[0] as {
    type?: string;
    props?: Record<string, unknown>;
  };
  if (first?.type !== "heading") return content;
  const props = first.props ?? {};
  // paragraph 仅保留通用排版属性（颜色/对齐），丢弃 heading 专属的 level / isToggleable。
  const paragraphProps: Record<string, unknown> = {};
  for (const key of ["textColor", "backgroundColor", "textAlignment"]) {
    if (props[key] !== undefined) paragraphProps[key] = props[key];
  }
  const demoted = { ...first, type: "paragraph", props: paragraphProps };
  return [demoted, ...content.slice(1)] as JSONContent;
}

/** 造一个用于驱动编辑器的草稿 page（不入 pages map、不持久化为 page 快照）。 */
export function buildQuickNoteDraftPage(content: JSONContent | null): Page {
  const now = Date.now();
  // 空白草稿一律从空段落起手，不预置任何标题块——小窗是「草稿便签」，不走主窗
  // 「首块恒为 H1」约定。这里对「无可见文本」的草稿（null / 单个空块，含早期 normalize
  // 未豁免时把空段落强转空 H1 回写持久化所留下的存量脏数据）统一归一成空段落：
  // 既保证新草稿不冒空标题1，也清掉存量脏数据。注意此处用结构化判空而非 isDraftEmpty
  // ——后者按 JSON 文本糊匹配，块 props 里的 "default"/"left" 等值含拉丁字母会被误判为非空。
  // 非空草稿再额外把「有内容的 H1 首块」降级为正文：覆盖存量脏数据，确保小窗首行永不是标题一。
  const draftContent = isBlankSingleBlockDraft(content)
    ? createEmptyLocalPageContent()
    : demoteFirstHeadingToParagraph(content as JSONContent);
  return {
    id: "__quicknote_draft__",
    workspaceId: DEFAULT_NOTEBOOK,
    parentId: undefined,
    content: draftContent,
    isFolder: false,
    isLocked: false,
    isFullWidth: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: now,
    updatedAt: now,
    order: now,
  };
}
