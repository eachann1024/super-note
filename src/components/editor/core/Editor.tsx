import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { useCreateBlockNote } from "@blocknote/react";
import { AIExtension } from "@blocknote/xl-ai";
import { zh as aiZh } from "@blocknote/xl-ai/locales";
import "@blocknote/xl-ai/style.css";
import { createGooseAITransport } from "@/components/editor/ai/transport/blocknoteAITransport";
import { zh } from "@blocknote/core/locales";
import "@blocknote/react/style.css";
import { createDebounce } from "@/components/editor/utils/debounce";
import {
  useEditorSettings,
  useEditorPageContext,
} from "@/components/editor/platform/hostContext";
import { useEditorPlatform } from "@/components/editor/platform/context";
import {
  clonePageContent,
  createEditorSafeContent,
  getContentSignature,
  normalizePageContent,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { markUserInteraction } from "@/lib/editor-interaction-signal";
import { normalizeExternalUrl } from "@/lib/openExternalUrl";
import { usePages as usePagesStore } from "@/stores/usePages";

/**
 * local-folder 页面内容 → 编辑器可用块数组（不做任何 normalize 改写）。
 * BlockNote 的 initialContent / replaceBlocks 不接受空数组，
 * 空文件 / 解析失败时兜底为单个空段落（仅编辑器呈现层，不回写 store）。
 */
function toEditorBlocks(content: unknown): BlockNoteContent {
  const blocks = Array.isArray(content) ? (content as BlockNoteContent) : [];
  if (blocks.length > 0) return blocks;
  return [{ type: "paragraph", content: "" }] as BlockNoteContent;
}

const contentSigCache = new WeakMap<object, string>();
function getCachedContentSignature(content: unknown): string {
  if (content && typeof content === "object") {
    const key = content as object;
    const hit = contentSigCache.get(key);
    if (hit) return hit;
    const sig = getContentSignature(content);
    contentSigCache.set(key, sig);
    return sig;
  }
  return getContentSignature(content);
}
import {
  getBlockNoteSlashMenuItems,
  filterSlashMenuItems,
} from "./blocknoteSlashItems";
import { gooseSelectAllExtension } from "@/components/editor/extensions/selectAllExtension";
import { createGooseLinkKeyboardExtension } from "@/components/editor/extensions/linkKeyboardExtension";
import { gooseTabBehaviorExtension } from "@/components/editor/extensions/tabBehaviorExtension";
import { gooseCodeBlockKeyboardExtension } from "@/components/editor/extensions/codeBlockKeyboardExtension";
import { gooseCodeBlockLinkStripExtension } from "@/components/editor/extensions/codeBlockLinkStripExtension";
import { gooseCalloutKeyboardExtension } from "@/components/editor/extensions/calloutKeyboardExtension";
import { gooseFirstTitleEnterExtension } from "@/components/editor/extensions/firstTitleEnterExtension";
import { gooseCollapsedToggleEnterExtension } from "@/components/editor/extensions/collapsedToggleEnterExtension";
import { gooseToggleHeadingAutoCollectExtension } from "@/components/editor/extensions/toggleHeadingAutoCollectExtension";
import { gooseEnterKeyBehaviorExtension } from "@/components/editor/extensions/gooseEnterKeyBehaviorExtension";
import { gooseCrossBlockDeleteExtension } from "@/components/editor/extensions/crossBlockDeleteExtension";
import { gooseEmptyBlockBackspaceExtension } from "@/components/editor/extensions/emptyBlockBackspaceExtension";
import { createGooseFirstTitleGuardExtension } from "@/components/editor/inputrules/firstTitleGuard";
import { gooseQuoteInputRuleExtension } from "@/components/editor/inputrules/quoteInputRule";
import { gooseMarkdownInputRulesExtension } from "@/components/editor/inputrules/markdownInputRules";
import { gooseSuppressMarkdownInSpecialBlocksExtension } from "@/components/editor/inputrules/suppressMarkdownInSpecialBlocks";
import { gooseHeadingMarkSuppressExtension } from "@/components/editor/extensions/headingMarkSuppressExtension";
import { gooseFakeSelectionExtension } from "@/components/editor/extensions/fakeSelectionExtension";
import { ArrowInputRuleExtension } from "@/components/editor/inputrules/arrowInputRule";
import { gooseToggleHeadingInputRuleExtension } from "@/components/editor/inputrules/toggleHeadingInputRule";
import { gooseFindInPageExtension } from "@/components/editor/find/findInPagePlugin";
import { createGooseSlashMenuReconcileExtension } from "@/components/editor/extensions/gooseSlashMenuReconcileExtension";
import { reconcileSlashSuggestionMenu } from "@/components/editor/utils/slashMenuPolicy";
import {
  EditorComposer,
  editorSchema,
  getSelectedCellPlainText,
  getSelectedPlainTextContext,
  isBottomEditorBlankClick,
  normalizeClipboardLineEndings,
  shouldPreferVisibleSelectionText,
  stripMarkdownHardBreaks,
} from "./EditorComposer";
import { shouldUseRawEditorContent } from "./editorContentMode";
import { isLinkworthyText } from "@/components/editor/utils/clipboard";
import { useEditorShortcuts } from "@/components/editor/hooks/useEditorShortcuts";
import { useEditorPaste } from "@/components/editor/hooks/useEditorPaste";
import { pasteClipboardFilesFromClipboard } from "@/components/editor/utils/pasteClipboardFilesFromClipboard";
import { clipboardHasPasteableImage } from "@/components/editor/utils/pasteClipboardImage";
import { uploadEditorFile } from "@/components/editor/utils/uploadEditorFile";
import { fileStorage, getFileUploadAvailability } from "@/lib/fileStorage";

export interface EditorRef {
  editor: ReturnType<typeof useCreateBlockNote> | null;
}

interface EditorProps {
  editable?: boolean;
  /**
   * 需从斜杠菜单隐藏的项标题列表（按 title 精确匹配）。
   * 速记小窗用它砍掉表格/图片/AI 等重型项，主窗不传则保持全量。
   */
  hiddenSlashItemTitles?: string[];
  /**
   * 是否显示块侧边菜单（+ / ⋮⋮）。默认 true（主编辑器）。
   * 速记小窗传 false：窄窗里浮动菜单与块 hover 判定互抢导致闪烁，索性不显示。
   */
  showSideMenu?: boolean;
}

export const Editor = forwardRef<EditorRef, EditorProps>(function Editor(
  { editable = true, hiddenSlashItemTitles, showSideMenu = true },
  ref,
) {
  const settings = useEditorSettings();
  const {
    theme,
    searchProviders,
    customActions,
    tableEvenColumnWidth,
    ai: aiSettings,
    enterKeyBehavior,
    utools,
  } = settings;
  const {
    page,
    isEditorFullWidth,
    onContentChange,
    getActivePageLocalFilePath,
  } = useEditorPageContext();
  const platform = useEditorPlatform();
  const activePageId = page?.id ?? null;

  const pageIdForUpdateRef = useRef<string | null>(null);
  const syncedContentSignatureRef = useRef<string | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const shiftPressedRef = useRef(false);
  pageIdForUpdateRef.current = page?.id ?? null;

  // 点击编辑器空白区域消闪：mousedown 时短暂抑制格式化工具栏（prosemirror 会先短暂
  // 出现非空选区再被 focusEditorEnd 塌缩），mouseup 时恢复。
  const [suppressFormattingToolbar, setSuppressFormattingToolbar] =
    useState(false);
  const suppressFormattingToolbarRef = useRef(false);

  // 注入回调/数据的最新引用：供 useCreateBlockNote（deps=[]）的闭包与各 effect 读取，
  // 避免把 settings/pageContext 直接进依赖数组导致编辑器重建（行为不变）。
  const aiSettingsRef = useRef(aiSettings);
  aiSettingsRef.current = aiSettings;
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const getActivePageLocalFilePathRef = useRef(getActivePageLocalFilePath);
  getActivePageLocalFilePathRef.current = getActivePageLocalFilePath;
  const pageRef = useRef(page);
  pageRef.current = page;
  // platformRef 供 useCreateBlockNote 闭包（deps=[]）调用平台能力，
  // 同 aiSettingsRef 模式，避免闭包捕获旧 platform 引用。
  const platformRef = useRef(platform);
  platformRef.current = platform;
  // utoolsRef 供 useCreateBlockNote 闭包（deps=[]）调用平台设置，避免闭包捕获旧配置
  const utoolsRef = useRef(utools);
  utoolsRef.current = utools;
  // settingsRef 供 useCreateBlockNote 闭包（deps=[]）调用平台设置，避免闭包捕获旧配置
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** uploadFile 与同 tick 粘贴需 getBlock；每 render 同步 */
  const editorInstanceRef = useRef<ReturnType<
    typeof useCreateBlockNote
  > | null>(null);

  // local-folder 页面跳过 normalizePageContent（含 ensureFirstTitleHeading），
  // 内容保持磁盘解析原样，避免 normalize 引发的结构变化误触写盘。
  // 内部笔记本仍走完整 normalizePageContent，首块 H1 约束不受影响。
  // 小窗草稿页(id 恒为 __quicknote_draft__)同样豁免首块 H1 约束,从正文开始
  const isLocalFolderPage = shouldUseRawEditorContent(page);
  const isLocalFolderPageRef = useRef(isLocalFolderPage);
  isLocalFolderPageRef.current = isLocalFolderPage;
  const normalizeContent = (c: unknown): BlockNoteContent =>
    isLocalFolderPage
      ? toEditorBlocks(c)
      : normalizePageContent(c as Parameters<typeof normalizePageContent>[0]);

  // 用户意图门控（仅 local-folder 页面消费）：BlockNote 对部分块（折叠块/视频/带
  // 属性图片等）会在初始化后异步补全 props，触发与基线签名不一致的 onChange——
  // 这不是用户编辑，不应入保存队列。这里记录「自上次程序化同步以来用户是否真实
  // 交互过」：pointerdown/keydown/paste/cut/drop 任一发生即视为有交互（覆盖打字、
  // IME、点勾选框/工具栏/菜单、拖拽块、表格操作等全部真实编辑入口；误报无害——
  // 内容未变签名相等不会入队，变了还有写盘前 diff 兜底）。切页/外部重载后重置。
  const userInteractedRef = useRef(false);
  useEffect(() => {
    const markInteracted = () => {
      userInteractedRef.current = true;
      markUserInteraction();
    };
    const events = ["pointerdown", "keydown", "paste", "cut", "drop"] as const;
    events.forEach((name) =>
      document.addEventListener(name, markInteracted, true),
    );
    return () =>
      events.forEach((name) =>
        document.removeEventListener(name, markInteracted, true),
      );
  }, []);

  // 程序化同步路径（非 silent 入队以外的 store 同步）：供 onChange 在「无用户交互」
  // 时把编辑器自动补全后的内容静默同步进 store（不标脏、不入保存队列、不刷 updatedAt）。
  const silentContentSync = useCallback((content: BlockNoteContent) => {
    onContentChangeRef.current(content, { silent: true });
  }, []);

  const initialContentRef = useRef(
    createEditorSafeContent(normalizeContent(page?.content), editorSchema),
  );
  // 初次 mount 时给 syncedContentSignatureRef 设置基线，
  // 否则切走时 flush 会把"只读打开"误判成编辑、刷新 updatedAt。
  if (syncedContentSignatureRef.current === null) {
    syncedContentSignatureRef.current = getCachedContentSignature(
      initialContentRef.current,
    );
  }
  // 同步 enterKeyBehavior 到 window.gooseEnterKeyBehavior 以便 keyboard extension 可以检测到变化
  useEffect(() => {
    interface GooseWindow extends Window {
      gooseEnterKeyBehavior?: "create-block" | "save-exit";
    }
    const gooseWindow = window as unknown as GooseWindow;
    gooseWindow.gooseEnterKeyBehavior = enterKeyBehavior;
  }, [enterKeyBehavior]);
  const editor = useCreateBlockNote(
    {
      initialContent: initialContentRef.current as any,
      schema: editorSchema,
      // `> ` → 引用、`<引号> ` → 引用,以及 Mod-Alt-q。这里把 `>` 让给折叠功能
      // (行首 `> ` → 折叠标题/折叠列表,见 toggleHeadingInputRule),引用改用 `| `/`｜ `
      // (见 quoteInputRule)。斜杠菜单仍可插入引用,不受影响。
      // 同时禁用 toggle-list-item-shortcuts:它的 Enter handler 对非空 toggleListItem
      // 无条件接管分裂(收起态也照分,把收起的 children 挤给新块,再也收不回去),且注册
      // 顺序先于自定义扩展、无法被 collapsedToggleEnterExtension 拦截。其全部行为
      // (空块降级 / 非空分裂 / Mod-Shift-6 转折叠列表)已在 collapsedToggleEnterExtension
      // 中按收起态感知重新实现。
      disableExtensions: [
        "quote-block-shortcuts",
        "toggle-list-item-shortcuts",
      ],
      extensions: [
        createGooseFirstTitleGuardExtension(isLocalFolderPageRef),
        gooseSuppressMarkdownInSpecialBlocksExtension,
        gooseHeadingMarkSuppressExtension,
        gooseTabBehaviorExtension,
        gooseSelectAllExtension,
        createGooseLinkKeyboardExtension(settingsRef),
        gooseCodeBlockKeyboardExtension,
        gooseCodeBlockLinkStripExtension,
        gooseCalloutKeyboardExtension,
        gooseFirstTitleEnterExtension,
        gooseCollapsedToggleEnterExtension,
        gooseToggleHeadingAutoCollectExtension(),
        gooseCrossBlockDeleteExtension,
        gooseEmptyBlockBackspaceExtension,
        createGooseSlashMenuReconcileExtension(
          isLocalFolderPageRef,
          editorInstanceRef,
        ),
        gooseEnterKeyBehaviorExtension,
        gooseQuoteInputRuleExtension,
        gooseMarkdownInputRulesExtension,
        gooseFakeSelectionExtension,
        ArrowInputRuleExtension,
        gooseToggleHeadingInputRuleExtension,
        gooseFindInPageExtension,
        // 速记小窗（__GOOSE_LITE__）不挂 AI 扩展：省去 @blocknote/xl-ai + @ai-sdk（~488K）解析。
        ...(__GOOSE_LITE__
          ? []
          : [
              AIExtension({
                transport: createGooseAITransport({
                  getSettings: () => aiSettingsRef.current,
                  getModelId: () =>
                    aiSettingsRef.current.selectedModelId || "gpt-4o-mini",
                  getCustomFetch: () => platformRef.current.ai.customFetch,
                }),
              }),
            ]),
      ],
      dictionary: {
        ...zh,
        placeholders: {
          ...zh.placeholders,
          default: "输入 / 或 、来展开菜单...",
          toggleListItem: "",
        },
        // 空折叠块展开后的提示行（默认「空的切换区。点击添加区块。」太生硬）
        toggle_blocks: { add_block_button: "空的折叠块，点击添加内容" },
        // 小窗无 AI，aiZh 在 lite 下是空壳，不并入字典。
        ...(__GOOSE_LITE__ ? {} : { ai: aiZh }),
      },
      domAttributes: {
        editor: {
          class: "goose-blocknote-editor",
        },
      },
      uploadFile: async (file, blockId) => {
        return uploadEditorFile(file, blockId, {
          getBlock: (id) => editorInstanceRef.current?.getBlock(id),
          imageStorage: platformRef.current.imageStorage,
          fileStorage,
          getFileUploadAvailability,
        });
      },
      pasteHandler: ({ event, editor: ed, defaultPasteHandler }) => {
        if (clipboardHasPasteableImage(event.clipboardData)) {
          void pasteClipboardFilesFromClipboard(event, ed);
          return true;
        }
        return defaultPasteHandler();
      },
      resolveFileUrl: async (url) => {
        return platformRef.current.imageStorage.resolveRefToUrl(
          url,
          getActivePageLocalFilePathRef.current(),
        );
      },
      links: {
        onClick: (event) => {
          if (!event.metaKey && !event.ctrlKey) {
            return false;
          }
          const target = event.target as HTMLElement | null;
          const link = target?.closest<HTMLAnchorElement>(
            'a[data-inline-content-type="link"]',
          );
          if (link) {
            const href = link.getAttribute("href");
            if (href) {
              const normalizedHref = normalizeExternalUrl(href);
              if (normalizedHref) {
                const useInternalBrowser =
                  utoolsRef.current?.openSearchInUtools ?? false;
                platformRef.current.shell.openUrl(
                  normalizedHref,
                  useInternalBrowser,
                );
              }
            }
          }
          return true;
        },
        // autolink/粘贴/HTML 导入的统一闸口：linkifyjs 认全量 TLD 表，
        // `AppClient.java`(.java 是真实 gTLD)这类类名/文件名会被误转链接，
        // 这里收紧为「协议白名单 + 裸域名常用 TLD 白名单」，见 isLinkworthyText。
        isValidLink: isLinkworthyText,
      },
    },
    [],
  );
  editorInstanceRef.current = editor;

  const debouncedUpdate = useMemo(() => {
    return createDebounce(
      (_id: string, content: BlockNoteContent) => {
        syncedContentSignatureRef.current = getCachedContentSignature(content);
        onContentChangeRef.current(content);
      },
      800,
      { maxWait: 3000 },
    );
  }, []);

  const prevPageIdRef = useRef<string | null>(activePageId);
  useEffect(() => {
    if (activePageId === prevPageIdRef.current) return;
    prevPageIdRef.current = activePageId;

    // 切页起点即重置：侧栏点击等切页前的 pointerdown 不应算进新页面的用户编辑。
    userInteractedRef.current = false;

    debouncedUpdate.cancel();

    const p = pageRef.current;
    pageIdForUpdateRef.current = p?.id ?? null;

    // local-folder 页面跳过 normalizePageContent（不触发 ensureFirstTitleHeading）。
    // 须与本文件 :135 的 isLocalFolderPage 及 EditorComposer.onChange 的判断一致：
    // 小窗草稿页(__quicknote_draft__)同样豁免，否则切页/重开时此处 replaceBlocks 会把
    // 首块强转 H1 并刷新签名基线，导致草稿首块每次重开都变「标题1」。
    const isLocalPage = shouldUseRawEditorContent(p);
    const nextContent = isLocalPage
      ? toEditorBlocks(p?.content)
      : normalizePageContent(p?.content);
    const nextEditorContent = createEditorSafeContent(
      nextContent,
      editor.schema,
    );
    const nextSig = getCachedContentSignature(nextEditorContent);

    syncedContentSignatureRef.current = nextSig;

    try {
      editor.replaceBlocks(editor.document, nextEditorContent as any);
    } catch (error) {
      console.error(
        "[goose-note] replace editor blocks failed during page switch",
        {
          pageId: p?.id,
          error,
        },
      );
      const fallbackContent = createEditorSafeContent(undefined, editor.schema);
      editor.replaceBlocks(editor.document, fallbackContent as any);
    }

    // replaceBlocks 后 appendTransaction（firstTitleGuard 等）可能已修改文档。
    // 用编辑器实际文档的签名更新基线，防止初始化触发的 onChange 误判为真实编辑。
    // 基线计算必须与 EditorComposer.onChange 完全一致（local 用 raw 文档，
    // 内部页面经 normalizePageContent），否则签名比较永不相等、打开即触发保存。
    const postReplaceRaw = clonePageContent(
      editor.document as BlockNoteContent,
    );
    syncedContentSignatureRef.current = getCachedContentSignature(
      isLocalPage ? postReplaceRaw : normalizePageContent(postReplaceRaw),
    );

    // Reset undo history so edits from the previous page don't leak
    const view = editor.prosemirrorView;
    if (view) {
      const newState = EditorState.create({
        doc: view.state.doc,
        plugins: view.state.plugins,
      });
      view.updateState(newState);
    }

    // normalize 改写了结构才回写（silent 路径：只同步内存，不触发写盘/标脏）。
    // local 页面不回写：内容未经 normalize，store 保持磁盘解析原样
    // （空文件的编辑器兜底空段落只是呈现层，不应进 store）。
    const normalizedSig = getCachedContentSignature(nextContent);
    if (
      p &&
      !isLocalPage &&
      getCachedContentSignature(p.content) !== normalizedSig
    ) {
      onContentChangeRef.current(nextContent, { silent: true });
    }

    // 切页完成 = 新一轮程序化同步起点，重置用户交互标记：
    // 切页后 BlockNote 的异步 props 补全（折叠块/视频等）不应被算作用户编辑。
    userInteractedRef.current = false;
  }, [activePageId, debouncedUpdate, editor]);

  const getSlashItems = useCallback(
    async (query: string) => {
      let items = getBlockNoteSlashMenuItems(
        editor,
        aiSettingsRef.current.enabled,
      );
      if (hiddenSlashItemTitles && hiddenSlashItemTitles.length > 0) {
        const hidden = new Set(hiddenSlashItemTitles);
        const isDivider = (it: (typeof items)[number]) =>
          (it as { type?: string }).type === "divider";
        const kept = items.filter((item) => !hidden.has(item.title));
        // 砍项后清理冗余分隔线：折叠连续/首部 divider，再去尾部 divider。
        const collapsed: typeof items = [];
        for (const it of kept) {
          if (
            isDivider(it) &&
            (collapsed.length === 0 ||
              isDivider(collapsed[collapsed.length - 1]))
          ) {
            continue;
          }
          collapsed.push(it);
        }
        while (
          collapsed.length > 0 &&
          isDivider(collapsed[collapsed.length - 1])
        ) {
          collapsed.pop();
        }
        items = collapsed;
      }
      return filterSlashMenuItems(items, query);
    },
    [editor, hiddenSlashItemTitles],
  );

  const { handleEditorPasteCapture } = useEditorPaste({
    editor,
    editable,
    shiftPressedRef,
  });

  // 冷加载时 BlockNoteView 尚未完全挂定，editor.focus() 会落到 view.dom，
  // 但此时 contentEditable 还未稳定，焦点会「漏」到侧栏页面重命名输入框等
  // 下一个可聚焦元素。guard：view 存在、dom 已连入文档且 doc 非空才聚焦；
  // 否则用 rAF 延后到下一帧（挂载完成）再试，避免冷加载点编辑器丢焦点。
  const focusEditorSafely = useCallback(() => {
    const tryFocus = () => {
      const view = editor.prosemirrorView;
      const dom = view?.dom as HTMLElement | undefined;
      if (view && dom && dom.isConnected && view.state.doc.content.size > 0) {
        editor.focus();
        return true;
      }
      return false;
    };
    if (!tryFocus()) {
      requestAnimationFrame(() => {
        tryFocus();
      });
    }
  }, [editor]);

  const focusEditorEnd = useCallback(() => {
    const lastBlock = editor.document.at(-1);
    if (lastBlock) {
      // 末块 content 为 "none"（image / divider / video / file 等无光标控件）时，
      // 无法直接聚焦末块末尾，在文档末尾插入一个空 paragraph 再聚焦它。
      const blockSpec = (editor.schema as any).blockSpecs?.[lastBlock.type];
      const contentType: string | undefined = blockSpec?.config?.content;
      if (contentType === "none") {
        editor.insertBlocks(
          [{ type: "paragraph", content: [] }],
          lastBlock,
          "after",
        );
        const newLast = editor.document.at(-1);
        if (newLast) {
          editor.setTextCursorPosition(newLast, "end");
        }
      } else {
        editor.setTextCursorPosition(lastBlock, "end");
      }
    }
    focusEditorSafely();
  }, [editor, focusEditorSafely]);

  const handleEditorBlankMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editable || event.button !== 0) return;
      const container = editorContainerRef.current;
      if (!container || !isBottomEditorBlankClick(event, container)) return;

      suppressFormattingToolbarRef.current = true;
      setSuppressFormattingToolbar(true);
      event.preventDefault();
      focusEditorEnd();
    },
    [editable, focusEditorEnd],
  );

  // 补丁：EditorContextMenu 容器高度 = 内容高度（flex-1 min-h-0），
  // 点击编辑器内容下方的空白时，event.target 落在外层 page-scroll-container 的背景上，
  // onMouseDown 不会冒泡到 workspace-editor-surface，所以需要在更上层监听。
  useEffect(() => {
    if (!editable) return;

    const handleDocMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const container = editorContainerRef.current;
      if (!container) return;

      // 只处理点击落在 page-scroll-container 内但不在 workspace-editor-surface 内的情况
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (container.contains(target)) return; // 已由 onMouseDown 处理
      const scrollContainer = target.closest(".page-scroll-container");
      if (!scrollContainer) return;

      // 检查 Y 坐标是否在末尾块之下（与 isBottomEditorBlankClick 逻辑一致）
      const blocks = container.querySelectorAll<HTMLElement>(".bn-block-outer");
      const lastBlock = blocks[blocks.length - 1];
      if (!lastBlock) return;
      if (event.clientY < lastBlock.getBoundingClientRect().bottom) return;

      // 点击确实在末块之下，阻止默认行为并聚焦末尾
      suppressFormattingToolbarRef.current = true;
      setSuppressFormattingToolbar(true);
      event.preventDefault();
      focusEditorEnd();
    };

    document.addEventListener("mousedown", handleDocMouseDown, true);
    return () => {
      document.removeEventListener("mousedown", handleDocMouseDown, true);
    };
  }, [editable, focusEditorEnd]);

  // 消闪 mouseup 清理：空白区域 mousedown 后抑制格式化工具栏，mouseup 时恢复。
  // 兜底 blur：鼠标拖出窗口松开时 document mouseup 不触发，window blur 覆盖此场景。
  useEffect(() => {
    const clearSuppress = () => {
      if (!suppressFormattingToolbarRef.current) return;
      suppressFormattingToolbarRef.current = false;
      setSuppressFormattingToolbar(false);
    };
    document.addEventListener("mouseup", clearSuppress, true);
    window.addEventListener("blur", clearSuppress);
    return () => {
      document.removeEventListener("mouseup", clearSuppress, true);
      window.removeEventListener("blur", clearSuppress);
    };
  }, []);

  useEditorShortcuts({ shiftPressedRef });

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const patchClipboardPlainText = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      const cellText = getSelectedCellPlainText(editor.prosemirrorState);
      if (cellText != null) {
        event.preventDefault();
        clipboardData.setData("text/plain", cellText);
        clipboardData.setData("text/html", "");
        return;
      }

      const clipboardText = normalizeClipboardLineEndings(
        clipboardData.getData("text/plain"),
      );
      // cut 时 PM 已写入剪贴板后才删选区；不拿 DOM 可见字覆盖 plain/html，
      // 否则行内 code 会被拆成两段（复制正常、剪切异常）。只清理 markdown 软换行反斜杠。
      const cleaned = stripMarkdownHardBreaks(clipboardText);
      if (cleaned !== clipboardText) {
        clipboardData.setData("text/plain", cleaned);
        return;
      }

      const selectionContext = getSelectedPlainTextContext(container);
      if (!selectionContext) return;

      if (
        shouldPreferVisibleSelectionText(
          clipboardText,
          selectionContext.selectedText,
          selectionContext.withinCodeBlock,
        )
      ) {
        clipboardData.setData("text/plain", selectionContext.selectedText);
      }
    };

    container.addEventListener("copy", patchClipboardPlainText);
    container.addEventListener("cut", patchClipboardPlainText);

    return () => {
      container.removeEventListener("copy", patchClipboardPlainText);
      container.removeEventListener("cut", patchClipboardPlainText);
    };
  }, []);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const onCompositionEnd = () =>
      queueMicrotask(() =>
        reconcileSlashSuggestionMenu(editor, {
          allowSlashMenuOnFirstBlock: isLocalFolderPageRef.current,
        }),
      );
    container.addEventListener("compositionend", onCompositionEnd);
    return () =>
      container.removeEventListener("compositionend", onCompositionEnd);
  }, [editor]);

  const commitEditorContent = useCallback(
    (targetPageId?: string) => {
      const safePageId = targetPageId ?? pageIdForUpdateRef.current;
      if (!safePageId) return;
      // local-folder 页面不走 normalizePageContent（避免 ensureFirstTitleHeading）
      const rawContent = clonePageContent(editor.document as BlockNoteContent);
      const nextContent = shouldUseRawEditorContent(pageRef.current)
        ? rawContent
        : normalizePageContent(rawContent);
      debouncedUpdate.cancel();
      const nextSig = getCachedContentSignature(nextContent);
      if (nextSig === syncedContentSignatureRef.current) return;
      syncedContentSignatureRef.current = nextSig;
      onContentChangeRef.current(nextContent);
    },
    [debouncedUpdate, editor],
  );

  useEffect(() => {
    return () => {
      debouncedUpdate.cancel();
    };
  }, [debouncedUpdate]);

  useEffect(() => {
    const handleFlush = (event: Event) => {
      const customEvent = event as CustomEvent<{ immediate?: boolean }>;
      if (customEvent.detail?.immediate) {
        commitEditorContent();
        return;
      }
      commitEditorContent();
    };

    const handleFocusStart = () => {
      focusEditorSafely();
    };

    const handlePluginEnter = () => {
      window.setTimeout(() => {
        focusEditorSafely();
      }, 0);
    };

    // 文件被外部修改后由宿主派发：把当前激活页最新内容刷进编辑器。
    const handleReloadActiveEditor = (event: Event) => {
      const detail = (event as CustomEvent<{ pageId?: string }>).detail;
      const activePage = pageRef.current;
      const activeId = activePage?.id ?? null;
      const targetId = detail?.pageId ?? activeId;
      if (!targetId || targetId !== activeId) return;
      if (targetId !== pageIdForUpdateRef.current) return;
      // 从 store 实时读内容（pageRef.current 可能是陈旧闭包值）
      const livePage = usePagesStore.getState().pages[targetId];
      if (!livePage) return;
      // local-folder 外部变更重载同样跳过 normalizePageContent
      const isLocalPage = shouldUseRawEditorContent(livePage);
      const nextContent = isLocalPage
        ? toEditorBlocks(livePage.content)
        : normalizePageContent(livePage.content);
      const nextEditorContent = createEditorSafeContent(
        nextContent,
        editor.schema,
      );
      debouncedUpdate.cancel();
      try {
        editor.replaceBlocks(editor.document, nextEditorContent as any);
      } catch (error) {
        console.error(
          "[goose-note] replace editor blocks failed during reload",
          {
            pageId: livePage.id,
            error,
          },
        );
        const fallbackContent = createEditorSafeContent(
          undefined,
          editor.schema,
        );
        editor.replaceBlocks(editor.document, fallbackContent as any);
      }
      // 基线与 EditorComposer.onChange 的计算方式保持一致（见切页 effect 注释）
      const reloadedRaw = clonePageContent(editor.document as BlockNoteContent);
      syncedContentSignatureRef.current = getContentSignature(
        isLocalPage ? reloadedRaw : normalizePageContent(reloadedRaw),
      );
      // 外部重载 = 程序化同步，重置用户交互标记（同切页 effect）。
      userInteractedRef.current = false;
    };

    window.addEventListener("goose-note:flush-editor", handleFlush);
    window.addEventListener("goose-note:focus-editor-start", handleFocusStart);
    window.addEventListener("goose-note:plugin-enter", handlePluginEnter);
    window.addEventListener(
      "goose-note:reload-active-editor",
      handleReloadActiveEditor,
    );

    return () => {
      window.removeEventListener("goose-note:flush-editor", handleFlush);
      window.removeEventListener(
        "goose-note:focus-editor-start",
        handleFocusStart,
      );
      window.removeEventListener("goose-note:plugin-enter", handlePluginEnter);
      window.removeEventListener(
        "goose-note:reload-active-editor",
        handleReloadActiveEditor,
      );
    };
  }, [commitEditorContent, debouncedUpdate, editor]);

  useImperativeHandle(
    ref,
    () => ({
      editor,
    }),
    [editor],
  );

  useEffect(() => {
    (window as any).__gooseNoteEditor = editor;
    return () => {
      if ((window as any).__gooseNoteEditor === editor) {
        (window as any).__gooseNoteEditor = null;
      }
    };
  }, [editor]);

  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">(
    "light",
  );

  useEffect(() => {
    const resolve = () => {
      if (theme === "dark") {
        setEffectiveTheme("dark");
        return;
      }
      if (theme === "system") {
        setEffectiveTheme(
          window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light",
        );
        return;
      }
      setEffectiveTheme("light");
    };
    resolve();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => resolve();
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  if (!page) return null;

  return (
    <EditorComposer
      editor={editor}
      editable={editable}
      page={page}
      editorContainerRef={editorContainerRef}
      handleEditorBlankMouseDown={handleEditorBlankMouseDown}
      handleEditorPasteCapture={handleEditorPasteCapture}
      getSlashItems={getSlashItems}
      pageIdForUpdateRef={pageIdForUpdateRef}
      syncedContentSignatureRef={syncedContentSignatureRef}
      debouncedUpdate={debouncedUpdate}
      userInteractedRef={userInteractedRef}
      silentContentSync={silentContentSync}
      isEditorFullWidth={isEditorFullWidth}
      effectiveTheme={effectiveTheme}
      tableEvenColumnWidth={tableEvenColumnWidth}
      searchProviders={searchProviders}
      customActions={customActions}
      showSideMenu={showSideMenu}
      suppressFormattingToolbar={suppressFormattingToolbar}
    />
  );
});
