// B 插件（鹅的速记）preload：纯速记小窗 toggle 逻辑，无主窗联动。
// CJS 运行在 uTools preload 上下文（Electron renderer），避免与 ESM 主项目冲突。

if (typeof window !== "undefined" && typeof utools !== "undefined") {
  window.utools = utools;

  // ── 速记小窗（独立 browser 窗口）──────────────────────────────
  const QUICKNOTE_WIDTH = 480;
  const QUICKNOTE_MIN_WIDTH = 320;
  const QUICKNOTE_HEIGHT = 350;
  const QUICKNOTE_MIN_HEIGHT = 300;
  const QUICKNOTE_EDGE_GAP = 16;
  let quickNoteWin = null;
  // 速记小窗强制置顶：恒为最前层，无取消置顶入口（产品决定）。
  const QUICKNOTE_ALWAYS_ON_TOP = true;
  let quickNoteVisible = false;
  let quickNoteActiveMode = null;

  const QUICKNOTE_DB_KEY = "goose-note:quicknote";
  const STORAGE_DOC_PREFIX = "gn:storage:";
  const getStorageDocId = (storageKey) => `${STORAGE_DOC_PREFIX}${storageKey}`;

  const clearHostQuickNoteEntryOnce = () => {
    try { utools.removeSubInput?.(); } catch { /* noop */ }
    try { utools.hideMainWindow?.(); } catch { /* noop */ }
  };

  const clearHostQuickNoteEntry = () => {
    clearHostQuickNoteEntryOnce();
    // uTools 可能在 feature enter 回调结束后重新绘制命中条。
    // 后续几拍继续清理，确保打开/关闭 toggle 都不残留宿主搜索框。
    [0, 16, 80, 180].forEach((delay) => {
      try { setTimeout(clearHostQuickNoteEntryOnce, delay); } catch { /* noop */ }
    });
  };

  const readStoredString = (storageKey) => {
    try {
      if (utools?.db?.get) {
        const doc = utools.db.get(getStorageDocId(storageKey));
        if (typeof doc?.data === "string") return doc.data;
        if (typeof doc?.data?.value === "string") return doc.data.value;
      }
    } catch { /* noop */ }

    try {
      const raw =
        utools.dbStorage && typeof utools.dbStorage.getItem === "function"
          ? utools.dbStorage.getItem(storageKey)
          : null;
      if (typeof raw === "string") {
        writeStoredString(storageKey, raw);
        return raw;
      }
    } catch { /* noop */ }

    return null;
  };

  const writeStoredString = (storageKey, value) => {
    let saved = false;
    try {
      if (utools?.db?.put && utools?.db?.get) {
        const docId = getStorageDocId(storageKey);
        const current = utools.db.get(docId);
        let result = utools.db.put({
          _id: docId,
          _rev: current?._rev,
          data: { value, updatedAt: Date.now() },
        });
        if (result?.ok === false) {
          const latest = utools.db.get(docId);
          result = utools.db.put({
            _id: docId,
            _rev: latest?._rev,
            data: { value, updatedAt: Date.now() },
          });
        }
        saved = result?.ok !== false;
      }
    } catch { /* noop */ }

    if (!saved) return;
    try {
      if (utools.dbStorage && typeof utools.dbStorage.removeItem === "function") {
        utools.dbStorage.removeItem(storageKey);
      }
    } catch { /* noop */ }
  };

  // 从 uTools db 文档读速记持久化偏好（与 A 插件共享同一 key，数据共通）。
  // 位置 windowX/windowY 可缺省（首次开窗或老数据）：缺省时回退到「光标屏右上角」。
  const readQuickNotePrefs = () => {
    const fallback = {
      windowWidth: QUICKNOTE_WIDTH,
      windowHeight: QUICKNOTE_HEIGHT,
      windowX: null,
      windowY: null,
    };
    try {
      const raw = readStoredString(QUICKNOTE_DB_KEY);
      if (typeof raw !== "string") return fallback;
      const parsed = JSON.parse(raw);
      const st = parsed && parsed.state ? parsed.state : parsed;
      const w = Number(st && st.windowWidth);
      const h = Number(st && st.windowHeight);
      const x = Number(st && st.windowX);
      const y = Number(st && st.windowY);
      return {
        windowWidth:
          Number.isFinite(w) && w >= QUICKNOTE_MIN_WIDTH ? Math.round(w) : QUICKNOTE_WIDTH,
        windowHeight:
          Number.isFinite(h) && h >= QUICKNOTE_MIN_HEIGHT ? Math.round(h) : QUICKNOTE_HEIGHT,
        windowX: Number.isFinite(x) ? Math.round(x) : null,
        windowY: Number.isFinite(y) ? Math.round(y) : null,
      };
    } catch {
      return fallback;
    }
  };

  // 把窗口当前 bounds（位置+尺寸）写回 db 文档，作为下次开窗的权威持久化来源。
  // persist-size（拖动停下）与关窗时都调用——拖动只触发 resize、移动不触发，故关窗兜底位置。
  const persistQuickNoteBounds = () => {
    if (!quickNoteWin || quickNoteWin.isDestroyed?.()) return;
    let bounds;
    try {
      bounds = quickNoteWin.getBounds?.();
    } catch { /* noop */ }
    if (!bounds || typeof bounds !== "object") return;
    const w = Math.max(QUICKNOTE_MIN_WIDTH, Math.round(Number(bounds.width) || 0));
    const h = Math.max(QUICKNOTE_MIN_HEIGHT, Math.round(Number(bounds.height) || 0));
    const x = Math.round(Number(bounds.x));
    const y = Math.round(Number(bounds.y));
    try {
      const raw = readStoredString(QUICKNOTE_DB_KEY);
      let parsed = {};
      if (typeof raw === "string") {
        try { parsed = JSON.parse(raw) || {}; } catch { parsed = {}; }
      }
      const hasStateWrapper = parsed && typeof parsed.state === "object" && parsed.state;
      const state = hasStateWrapper ? parsed.state : parsed;
      state.windowWidth = w;
      state.windowHeight = h;
      if (Number.isFinite(x)) state.windowX = x;
      if (Number.isFinite(y)) state.windowY = y;
      const next = hasStateWrapper ? { ...parsed, state } : { state, version: 0 };
      writeStoredString(QUICKNOTE_DB_KEY, JSON.stringify(next));
    } catch { /* noop */ }
  };

  // 只更新位置 x/y 写回 db 文档（尺寸保持库中原值）。供子窗移动上报使用：
  // 直接用传入坐标，不读 getBounds，避开关窗销毁瞬间取值不可靠的问题。
  const persistQuickNotePosition = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    try {
      const raw = readStoredString(QUICKNOTE_DB_KEY);
      let parsed = {};
      if (typeof raw === "string") {
        try { parsed = JSON.parse(raw) || {}; } catch { parsed = {}; }
      }
      const hasStateWrapper = parsed && typeof parsed.state === "object" && parsed.state;
      const state = hasStateWrapper ? parsed.state : parsed;
      state.windowX = Math.round(x);
      state.windowY = Math.round(y);
      const next = hasStateWrapper ? { ...parsed, state } : { state, version: 0 };
      writeStoredString(QUICKNOTE_DB_KEY, JSON.stringify(next));
    } catch { /* noop */ }
  };

  // 关窗=隐藏（不销毁）：窗口常驻后台，下次唤起秒显（省去重新加载页面 + 重跑 bootstrap）。
  // 隐藏前持久化 bounds；保留 quickNoteWin 引用、仅置 visible=false。
  // 若窗口已被宿主销毁（isDestroyed），清空引用走下次新建路径。
  const hideQuickNoteWindow = () => {
    clearHostQuickNoteEntry();
    if (!quickNoteWin || quickNoteWin.isDestroyed?.()) {
      quickNoteWin = null;
      quickNoteVisible = false;
      quickNoteActiveMode = null;
      return;
    }
    persistQuickNoteBounds();
    try { quickNoteWin.hide?.(); } catch { /* noop */ }
    quickNoteVisible = false;
    quickNoteActiveMode = null;
    clearHostQuickNoteEntry();
  };

  // 复用已隐藏的窗口：show + focus + 置顶，并推 enter 让子窗重新聚焦光标（草稿延续，不重解析）。
  const showExistingQuickNoteWindow = (mode) => {
    if (!quickNoteWin || quickNoteWin.isDestroyed?.()) return false;
    clearHostQuickNoteEntry();
    try {
      quickNoteWin.show?.();
      quickNoteWin.focus?.();
      try { quickNoteWin.setAlwaysOnTop?.(true, "screen-saver"); } catch { /* noop */ }
      quickNoteVisible = true;
      quickNoteActiveMode = mode;
      try { quickNoteWin.webContents?.send?.("quicknote:enter", { mode }); } catch { /* noop */ }
      return true;
    } catch {
      return false;
    }
  };

  // getWindowType 三态：main=吸附在 uTools、detach=分离独立窗口、browser=createBrowserWindow 子窗。
  // B 插件：宿主（main/detach）负责开窗；子窗（browser）只走子窗侧逻辑。
  const isMainWindow =
    typeof utools.getWindowType !== "function" ||
    utools.getWindowType() !== "browser";

  // ── 子窗侧（browser）：监听父窗推过来的信号，转成 DOM 事件供 QuickNoteApp 消费 ──
  if (!isMainWindow) {
    // 注入标志：告知 QuickNoteApp 当前运行于 B 插件独立速记子窗，保存应 redirect 回 A。
    window.__GOOSE_QUICKNOTE_STANDALONE__ = true;
    try {
      const { ipcRenderer } = require("electron");
      ipcRenderer.on("quicknote:enter", (_e, data) => {
        window.dispatchEvent(
          new CustomEvent("goose-note:quicknote-enter", { detail: data || {} }),
        );
      });
      // 外部改了笔记：转 DOM 事件，小窗据此从 db 重读（防跨窗脏写）。
      ipcRenderer.on("quicknote:note-updated-from-main", (_e, pageId) => {
        window.dispatchEvent(
          new CustomEvent("goose-note:note-updated-external", {
            detail: { pageId },
          }),
        );
      });
    } catch { /* noop */ }
  }

  // ── 宿主侧（main/detach）：持有 quickNoteWin，处理子窗通过 sendToParent 发来的请求 ──
  if (isMainWindow) try {
    const { ipcRenderer } = require("electron");

    // 强制置顶后无置顶切换入口；保留监听仅为兼容旧子窗发来的 pin 请求，不做任何操作。
    ipcRenderer.on("quicknote:pin", () => { /* 强制置顶，忽略 */ });

    ipcRenderer.on("quicknote:close", () => {
      // 子窗 Esc / 关闭按钮：隐藏而非销毁，窗口常驻后台，下次唤起秒显。
      // hideQuickNoteWindow 内部已持久化 bounds（关窗是位置/尺寸终态、最可靠的记忆时机）。
      hideQuickNoteWindow();
    });

    // 自动调整高度：子窗按内容算出目标高度，请求父窗 setSize（宽度保持不变）。
    ipcRenderer.on("quicknote:set-height", (_e, height) => {
      if (!quickNoteWin || quickNoteWin.isDestroyed?.()) return;
      const h = Math.max(QUICKNOTE_MIN_HEIGHT, Math.round(Number(height) || 0));
      try {
        const [w] = quickNoteWin.getSize?.() || [QUICKNOTE_WIDTH];
        quickNoteWin.setSize(w || QUICKNOTE_WIDTH, h, false);
      } catch { /* noop */ }
    });

    // 用户拖动边框停下后：读真实窗口 bounds（位置+尺寸），写回 dbStorage 速记偏好（持久化）。
    ipcRenderer.on("quicknote:persist-size", () => {
      persistQuickNoteBounds();
    });

    // 用户拖动窗口移动停下后：子窗用 screenX/screenY 上报当前位置，直接写回持久化。
    // 移动不触发 resize，且关窗时 getBounds() 在窗口销毁瞬间可能取到旧值/默认值，
    // 故由子窗在移动停下时主动上报坐标，绕开 getBounds 的时机不可靠问题。
    ipcRenderer.on("quicknote:persist-position", (_e, pos) => {
      const x = Math.round(Number(pos && pos.x));
      const y = Math.round(Number(pos && pos.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      persistQuickNotePosition(x, y);
    });

    // 小窗改动某条笔记：B 插件无主窗，此处仅作空消费（防止 sendToParent 丢失报错）。
    ipcRenderer.on("quicknote:note-updated", (_e, _pageId) => {
      // B 无主窗，不需要跨窗同步；保留监听避免 ipc 无人接收时的警告。
    });

  } catch { /* noop */ }

  // ── 打开速记小窗 ──────────────────────────────────────────────
  const openQuickNoteWindow = (mode) => {
    clearHostQuickNoteEntry();
    // 窗口常驻：再次触发 = toggle。可见 → 隐藏；已隐藏 → 秒显（复用已加载的窗口）。
    if (quickNoteWin && !quickNoteWin.isDestroyed?.()) {
      if (quickNoteVisible) {
        hideQuickNoteWindow();
      } else {
        showExistingQuickNoteWindow(mode);
      }
      return;
    }

    // 读持久化偏好：用记住的宽高+位置开窗。
    const prefs = readQuickNotePrefs();
    const openWidth = prefs.windowWidth;
    const openHeight = prefs.windowHeight;

    const winOpts = {
      show: false,
      width: openWidth,
      height: openHeight,
      minWidth: QUICKNOTE_MIN_WIDTH,
      minHeight: QUICKNOTE_MIN_HEIGHT,
      frame: false,
      resizable: true,
      skipTaskbar: true,
      closable: true,
      alwaysOnTop: QUICKNOTE_ALWAYS_ON_TOP,
      // 小窗需要从背景中浮出来；边界感由原生外投影 + Web 内描边共同承担。
      hasShadow: true,
      roundedCorners: true,
      webPreferences: {
        preload: "preload-quicknote.js",
      },
    };

    // 位置：优先用记住的 x/y；缺省（首次开窗/老数据）才回退到光标所在屏右上角。
    if (prefs.windowX !== null && prefs.windowY !== null) {
      winOpts.x = prefs.windowX;
      winOpts.y = prefs.windowY;
    } else {
      // 定位到光标所在显示器的右上角。优先用 workArea（已扣除 macOS 菜单栏/Dock）。
      let area = null;
      try {
        const point = utools.getCursorScreenPoint();
        const display = utools.getDisplayNearestPoint(point);
        area = display ? display.workArea || display.bounds : null;
      } catch { /* noop */ }
      if (area) {
        winOpts.x = Math.round(area.x + area.width - openWidth - QUICKNOTE_EDGE_GAP);
        winOpts.y = Math.round(area.y + QUICKNOTE_EDGE_GAP);
      }
    }

    const url = `quicknote.html`;
    try {
      quickNoteWin = utools.createBrowserWindow(url, winOpts, () => {
        try {
          // 显式回设 bounds：部分 uTools / Electron 版本会忽略 createBrowserWindow
          // 的 winOpts.x/y（改为居中或默认位置），导致「记住的位置」开窗时不生效，
          // 表现为每次开窗都回到默认位置（用户感知为「关闭后位置被重置」）。
          // 这里在窗口就绪后用 setBounds 强制落到持久化的位置+尺寸，作为权威修正。
          if (
            typeof winOpts.x === "number" &&
            typeof winOpts.y === "number" &&
            typeof quickNoteWin.setBounds === "function"
          ) {
            try {
              quickNoteWin.setBounds({
                x: winOpts.x,
                y: winOpts.y,
                width: openWidth,
                height: openHeight,
              });
            } catch { /* noop */ }
          }
          quickNoteWin.show();
          quickNoteWin.focus?.();
          quickNoteVisible = true;
          quickNoteActiveMode = mode;
          // 强制置顶：用最高层级 screen-saver，确保盖在其他置顶窗之上。
          try { quickNoteWin.setAlwaysOnTop(true, "screen-saver"); } catch { /* noop */ }
        } catch { /* noop */ }
      });
    } catch { /* noop */ }
  };

  const triggerQuickNote = (mode) => {
    openQuickNoteWindow(mode);
  };

  // 无主界面模板插件：每个 feature 用 mode:"none"，enter 回调里开浮窗。
  // 必须用 isMainWindow 守卫——子窗（browser）加载 quicknote.html 时也会跑这份 preload，
  // 不能让子窗也定义 window.exports（否则覆盖宿主入口、重复定义）。
  if (isMainWindow) {
    const enterQuickNote = (mode) => {
      try {
        triggerQuickNote(mode);
      } catch { /* noop */ }
      clearHostQuickNoteEntry();
      // ⚠️ 关键：不要 outPlugin！B 进程要常驻持有 quickNoteWin 引用，
      // 否则第二次按速记键的 toggle 关窗会失效（引用丢了变成又开一个新窗）。
      // mode:"none" 在真机仍可能短暂留下宿主命中条；这里显式隐藏主窗并移除 subInput。
    };
    window.exports = {
      quicknote_new: {
        mode: "none",
        args: {
          enter: () => enterQuickNote("new"),
        },
      },
      quicknote_last: {
        mode: "none",
        args: {
          enter: () => enterQuickNote("last"),
        },
      },
    };

    if (typeof utools.onPluginOut === "function") {
      utools.onPluginOut(() => {
        clearHostQuickNoteEntry();
      });
    }
  }
}
