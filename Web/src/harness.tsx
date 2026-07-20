import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
} from "lucide-react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { EditorSurface } from "./components/EditorSurface";
import { installBrowserBridge } from "./lib/bridge";
import type { BridgeMessage, EditorPagePayload, HostMessage, SaveAcknowledgement } from "./lib/types";
import "./styles/editor.css";
import "./styles/harness.css";

interface HarnessDocument {
  id: string;
  title: string;
  relativePath: string;
  markdown: string;
  revision: number;
}

const initialDocuments: HarnessDocument[] = [
  {
    id: "document-plan",
    title: "五一千岛湖露营.md",
    relativePath: "五一千岛湖露营.md",
    revision: 1,
    markdown: "和小宇、阿楠一行 5 人。把要带的东西、路线和账都记在这一页。\n\n## 出发前\n\n- 炭、喷枪、防风打火机\n- 饮用水两大桶和一箱气泡水\n- [x] 帐篷、地钉和防潮垫\n- [ ] 充电宝充满电",
  },
  {
    id: "document-reading",
    title: "七月阅读清单.md",
    relativePath: "阅读/七月阅读清单.md",
    revision: 2,
    markdown: "把想读的书先放在这里，读完再整理笔记。\n\n1. 置身事内\n2. 可能性的艺术",
  },
  {
    id: "document-ideas",
    title: "零散想法.md",
    relativePath: "灵感/零散想法.md",
    revision: 1,
    markdown: "先写下来，稍后再决定放到哪里。",
  },
  {
    id: "document-source",
    title: "源码保真.md",
    relativePath: "源码保真.md",
    revision: 1,
    markdown: "---\ntitle: 原样保留\ntags: [本地, Markdown]\n---\n\n<div data-note=\"raw\">HTML</div>\n",
  },
];

const alternateFolderDocuments: HarnessDocument[] = [
  {
    id: "document-project-readme",
    title: "README.md",
    relativePath: "README.md",
    revision: 1,
    markdown: "# Super Note\n\n这是打开文件夹后默认选中的第一个 Markdown 文件。",
  },
  {
    id: "document-project-changelog",
    title: "CHANGELOG.md",
    relativePath: "docs/CHANGELOG.md",
    revision: 1,
    markdown: "# 更新记录\n\n- 支持打开本地文件夹",
  },
];

function Harness() {
  const [documents, setDocuments] = useState(() => structuredClone(initialDocuments));
  const [workspaceName, setWorkspaceName] = useState("露营计划");
  const [tabs, setTabs] = useState<string[]>(["document-plan"]);
  const [activeID, setActiveID] = useState<string | null>("document-plan");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia("(max-width: 560px)").matches);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const generationRef = useRef(0);
  const activeIDRef = useRef(activeID);
  const documentsRef = useRef(documents);
  const tabsRef = useRef(tabs);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  activeIDRef.current = activeID;
  documentsRef.current = documents;
  tabsRef.current = tabs;

  const sendDocument = (documentID: string) => {
    const document = documentsRef.current.find((item) => item.id === documentID);
    if (!document || !window.gooseEditor) return;
    generationRef.current += 1;
    const payload: EditorPagePayload = {
      version: 1,
      generation: generationRef.current,
      pageID: document.id,
      revision: document.revision,
      title: document.title.replace(/\.(md|markdown)$/i, ""),
      markdown: document.markdown,
      appearance: theme,
      editorFont: "serif",
      fullWidth: false,
      reduceMotion: false,
      increaseContrast: false,
    };
    void window.gooseEditor.receivePage(payload);
  };

  const handleHostMessage = (message: BridgeMessage) => {
    if (message.type === "ready") {
      window.requestAnimationFrame(() => {
        if (activeIDRef.current) sendDocument(activeIDRef.current);
      });
      return;
    }
    if (message.type === "reloadRequest") {
      sendDocument(message.pageID);
      return;
    }
    if (message.type === "dirty") {
      if (message.pageID === activeIDRef.current) setSaveState("saving");
      return;
    }

    const draft = message as HostMessage;
    setSaveState("saving");
    window.setTimeout(() => {
      const current = documentsRef.current.find((document) => document.id === draft.pageID);
      if (!current) return;
      if (!draft.hasChanges) {
        window.gooseEditor.receiveAcknowledgement({
          version: 1,
          requestID: draft.requestID,
          pageID: draft.pageID,
          revision: current.revision,
          status: "saved",
        });
        setSaveState("saved");
        return;
      }
      const nextTitle = `${draft.title.trim() || "未命名"}.md`;
      const parentPath = current.relativePath.includes("/")
        ? current.relativePath.slice(0, current.relativePath.lastIndexOf("/") + 1)
        : "";
      const changed = current.title !== nextTitle || current.markdown !== draft.markdown;
      const nextRevision = changed ? Math.max(current.revision + 1, draft.baseRevision + 1) : current.revision;
      const nextDocuments = documentsRef.current.map((document) => document.id === draft.pageID ? {
        ...document,
        title: nextTitle,
        relativePath: `${parentPath}${nextTitle}`,
        markdown: draft.markdown,
        revision: nextRevision,
      } : document);
      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      const acknowledgement: SaveAcknowledgement = {
        version: 1,
        requestID: draft.requestID,
        pageID: draft.pageID,
        revision: nextRevision,
        status: "saved",
      };
      window.gooseEditor.receiveAcknowledgement(acknowledgement);
      setSaveState("saved");
    }, 90);
  };

  useLayoutEffect(() => installBrowserBridge(handleHostMessage));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.gooseEditor?.updatePreferences({
      appearance: theme,
      editorFont: "serif",
      fullWidth: false,
      reduceMotion: false,
      increaseContrast: false,
    });
  }, [theme]);

  useEffect(() => {
    if (!searchOpen) return;
    const closeSearch = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSearchOpen(false);
      window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
    };
    document.addEventListener("keydown", closeSearch);
    return () => document.removeEventListener("keydown", closeSearch);
  }, [searchOpen]);

  const openDocument = (id: string) => {
    activeIDRef.current = id;
    setActiveID(id);
    setTabs((current) => current.includes(id) ? current : [...current, id]);
    window.requestAnimationFrame(() => sendDocument(id));
  };

  const closeDocument = (id: string) => {
    const index = tabsRef.current.indexOf(id);
    const nextTabs = tabsRef.current.filter((documentID) => documentID !== id);
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    if (id !== activeIDRef.current) return;
    const replacement = nextTabs[Math.min(index, nextTabs.length - 1)];
    if (replacement) {
      activeIDRef.current = replacement;
      setActiveID(replacement);
      window.requestAnimationFrame(() => sendDocument(replacement));
    } else {
      activeIDRef.current = null;
      setActiveID(null);
      window.gooseEditor?.clear();
    }
  };

  const createDocument = () => {
    const id = `document-${crypto.randomUUID()}`;
    const document: HarnessDocument = { id, title: "未命名.md", relativePath: "未命名.md", markdown: "", revision: 0 };
    const nextDocuments = [...documentsRef.current, document];
    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
    tabsRef.current = [...tabsRef.current, id];
    setTabs(tabsRef.current);
    activeIDRef.current = id;
    setActiveID(id);
    window.requestAnimationFrame(() => sendDocument(id));
  };

  const openFolder = () => {
    const nextDocuments = structuredClone(alternateFolderDocuments);
    const first = nextDocuments[0];
    documentsRef.current = nextDocuments;
    tabsRef.current = first ? [first.id] : [];
    activeIDRef.current = first?.id ?? null;
    setWorkspaceName("super-note");
    setDocuments(nextDocuments);
    setTabs(tabsRef.current);
    setActiveID(activeIDRef.current);
    setSearchQuery("");
    setSaveState("saved");
    window.requestAnimationFrame(() => {
      if (first) sendDocument(first.id);
      else window.gooseEditor?.clear();
    });
  };

  const results = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return documents;
    return documents.filter((document) => (
      `${document.title} ${document.markdown}`.toLocaleLowerCase("zh-CN").includes(query)
    ));
  }, [documents, searchQuery]);

  const visibleDocuments = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return documents;
    return documents.filter((document) => (
      `${document.title} ${document.markdown}`.toLocaleLowerCase("zh-CN").includes(query)
    ));
  }, [documents, searchQuery]);

  const activeDocument = activeID ? documents.find((document) => document.id === activeID) : undefined;

  return (
    <div className="harness" role="application" aria-label="鹅的笔记" data-theme={theme} data-testid="app-shell">
      <header className="harness-titlebar">
        <div className="traffic-lights" aria-hidden="true"><i /><i /><i /></div>
        <span className="harness-app-title">鹅的笔记</span>
        <button type="button" className="icon-button" aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
          {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      </header>
      <div className="harness-body">
        <aside className={`harness-sidebar${sidebarCollapsed ? " is-collapsed" : ""}`} aria-label="文件导航" aria-hidden={sidebarCollapsed} inert={sidebarCollapsed}>
          <div className="notebook-title">
            <FolderOpen size={16} />
            <strong>{workspaceName}</strong>
            <button type="button" className="folder-switch" aria-label="打开文件夹" onClick={openFolder}><FolderPlus size={15} /></button>
            <button
              type="button"
              className="compact-sidebar-close"
              aria-label="关闭侧边栏"
              onClick={() => {
                setSidebarCollapsed(true);
                window.requestAnimationFrame(() => window.gooseEditor?.focusEditor());
              }}
            ><PanelLeftClose size={16} /></button>
          </div>
          <button ref={searchTriggerRef} type="button" className="sidebar-action" onClick={() => { setSearchQuery(""); setSearchOpen(true); }}>
            <Search size={15} />搜索文件夹中的 Markdown<span>⌘K</span>
          </button>
          <div className="sidebar-section-heading">
            <span>Markdown 文件</span>
            <button type="button" aria-label="新建 Markdown 文件" onClick={createDocument}><FilePlus2 size={14} /></button>
          </div>
          <nav className="page-list" aria-label="已打开的 Markdown 文件">
            {visibleDocuments.map((document) => (
              <div className="page-row-wrap" key={document.id}>
                <button type="button" aria-current={document.id === activeID ? "page" : undefined} className={`page-row${document.id === activeID ? " is-active" : ""}`} onClick={() => openDocument(document.id)}>
                  <span><FileText size={14} /></span>
                  <span>{document.relativePath}</span>
                </button>
              </div>
            ))}
            {visibleDocuments.length === 0 && <p className="sidebar-empty">没有找到匹配的文件</p>}
          </nav>
          <div className="sidebar-footer-actions">
            <button type="button" className="new-page-button" onClick={createDocument}><FilePlus2 size={15} />新建文件</button>
            <button type="button" className="new-page-button" onClick={openFolder}><FolderPlus size={15} />打开文件夹</button>
          </div>
        </aside>
        <section className="harness-workspace">
          <div className="harness-toolbar">
            <button type="button" className="icon-button" aria-label={sidebarCollapsed ? "显示侧边栏" : "隐藏侧边栏"} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <div className="harness-tabs" role="tablist" aria-label="打开的文件">
              {tabs.map((id) => {
                const document = documents.find((item) => item.id === id);
                if (!document) return null;
                return (
                  <div className={`harness-tab${id === activeID ? " is-active" : ""}`} role="presentation" key={id}>
                    <button id={`document-tab-${id}`} type="button" role="tab" aria-selected={id === activeID} aria-controls="goose-editor-panel" onClick={() => openDocument(id)}>{document.title}</button>
                    <button type="button" aria-label={`关闭${document.title}`} onClick={() => closeDocument(id)}>×</button>
                  </div>
                );
              })}
            </div>
            <span className={`save-status is-${saveState}`} aria-live="polite">
              {saveState === "saving" ? "正在写入文件…" : saveState === "failed" ? "保存失败" : <><Check size={13} />已保存到磁盘</>}
            </span>
          </div>
          <div id="goose-editor-panel" className="harness-editor" role="tabpanel" aria-labelledby={activeID ? `document-tab-${activeID}` : undefined}>
            <EditorSurface />
          </div>
        </section>
      </div>
      {searchOpen && (
        <div className="search-backdrop" role="presentation" onMouseDown={() => {
          setSearchOpen(false);
          window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
        }}>
          <section className="search-panel" role="dialog" aria-modal="true" aria-label="搜索已打开文件" onMouseDown={(event) => event.stopPropagation()}>
            <label><Search size={17} /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索文件名和正文" aria-label="搜索文件名和正文" /></label>
            <div className="search-results" role="listbox">
              {results.map((document) => <button role="option" aria-selected="false" type="button" key={document.id} onClick={() => {
                setSearchOpen(false);
                openDocument(document.id);
              }}><span>📄</span><span>{document.title}</span></button>)}
              {results.length === 0 && <p>没有找到匹配的文件</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
