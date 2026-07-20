import AppKit

extension NSToolbarItem.Identifier {
    static let gooseToggleSidebar = NSToolbarItem.Identifier("GooseNotes.ToggleSidebar")
}

@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate, NSToolbarDelegate {
    let store: DocumentStore
    let splitController: MainSplitViewController
    private let observerTokens = NotificationTokenBag()

    init(store: DocumentStore) {
        self.store = store
        splitController = MainSplitViewController(store: store)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "鹅的笔记"
        window.titleVisibility = .hidden
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 780, height: 520)
        window.contentViewController = splitController
        window.isReleasedWhenClosed = false
        super.init(window: window)
        setupWindow()
        wireActions()
        observerTokens.values.append(NotificationCenter.default.addObserver(
            forName: .documentsDidChange, object: store, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.updateWindowTitle() } })
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func show() {
        guard let window else { return }
        window.setFrameAutosaveName("GooseNotes.MainWindow")
        if !window.setFrameUsingName("GooseNotes.MainWindow") { window.center() }
        showWindow(nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        splitController.sidebarController.reload()
        splitController.editorController.reload()
        splitController.editorController.focusEditor()
        updateWindowTitle()
    }

    func flushEditor(completion: @escaping (Bool) -> Void) {
        splitController.editorController.flush(completion: completion)
    }

    func createDocument() {
        flushEditor { [weak self] success in
            guard let self, success else { return }
            let panel = NSSavePanel()
            panel.title = "新建 Markdown 文件"
            panel.prompt = "创建"
            panel.allowedContentTypes = [MarkdownFileType.contentType]
            panel.canCreateDirectories = true
            panel.directoryURL = store.workspace?.folderURL
            panel.nameFieldStringValue = "未命名.md"
            guard panel.runModal() == .OK, let url = panel.url else { return }
            Task {
                do {
                    _ = try await store.create(at: url)
                    splitController.editorController.reload(forceEditor: true)
                    splitController.editorController.focusEditor()
                } catch {
                    showError("无法创建 \(url.lastPathComponent)：\(error.localizedDescription)")
                }
            }
        }
    }

    func chooseDocumentsToOpen() {
        let panel = NSOpenPanel()
        panel.title = "打开 Markdown 文件"
        panel.allowedContentTypes = [MarkdownFileType.contentType]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK else { return }
        openDocuments(urls: panel.urls)
    }

    func chooseFolderToOpen() {
        let panel = NSOpenPanel()
        panel.title = "打开 Markdown 文件夹"
        panel.prompt = "打开"
        panel.message = "选择一个文件夹，侧边栏会显示其中的 Markdown 文件。"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        openFolder(url: url)
    }

    func openFolder(url: URL) {
        flushEditor { [weak self] success in
            guard let self, success else { return }
            Task {
                do {
                    _ = try await store.openFolder(url: url)
                    splitController.editorController.reload(forceEditor: true)
                    splitController.editorController.focusEditor()
                    updateWindowTitle()
                } catch {
                    showError("无法打开文件夹 \(url.lastPathComponent)：\(error.localizedDescription)")
                }
            }
        }
    }

    func openDocuments(urls: [URL]) {
        guard !urls.isEmpty else { return }
        flushEditor { [weak self] success in
            guard let self, success else { return }
            Task {
                for url in urls {
                    do {
                        _ = try await store.open(url: url)
                    } catch {
                        showError("无法打开 \(url.lastPathComponent)：\(error.localizedDescription)")
                    }
                }
                splitController.editorController.reload(forceEditor: true)
                splitController.editorController.focusEditor()
                show()
            }
        }
    }

    func saveActiveDocument() {
        flushEditor { [weak self] success in
            if !success { self?.showError("无法保存当前 Markdown 文件。") }
        }
    }

    func closeActiveDocument() {
        guard let id = store.activeDocumentID else { return }
        closeDocument(id: id)
    }

    func closeDocument(id: String) {
        guard store.document(id: id) != nil else { return }
        let close = {
            self.store.closeDocument(id: id)
            self.splitController.editorController.reload(forceEditor: true)
        }
        if store.activeDocumentID == id {
            flushEditor { success in if success { close() } }
        } else {
            close()
        }
    }

    func revealActiveDocument() {
        guard let url = store.activeDocument?.fileURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    func revealDocument(id: String) {
        guard let url = store.document(id: id)?.fileURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    func focusSearch() { splitController.sidebarController.focusSearch() }
    func toggleSidebar() { splitController.toggleSidebar() }
    func dispatchEditorCommand(_ command: String) { splitController.editorController.dispatchEditorCommand(command) }
    func printEditor() { splitController.editorController.printEditor() }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "鹅的笔记"
        alert.informativeText = message
        alert.runModal()
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.gooseToggleSidebar, .flexibleSpace]
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.gooseToggleSidebar, .flexibleSpace]
    }

    func toolbar(
        _ toolbar: NSToolbar,
        itemForItemIdentifier itemIdentifier: NSToolbarItem.Identifier,
        willBeInsertedIntoToolbar flag: Bool
    ) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: itemIdentifier)
        switch itemIdentifier {
        case .gooseToggleSidebar:
            item.label = "侧边栏"
            item.image = NSImage(systemSymbolName: "sidebar.left", accessibilityDescription: "显示或隐藏侧边栏")
            item.target = self
            item.action = #selector(toolbarToggleSidebar(_:))
        default:
            return nil
        }
        return item
    }

    private func setupWindow() {
        guard let window else { return }
        window.delegate = self
        window.collectionBehavior.insert(.fullScreenPrimary)
        let toolbar = NSToolbar(identifier: "GooseNotes.MainToolbar")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        window.toolbarStyle = .unifiedCompact
    }

    private func wireActions() {
        let sidebar = splitController.sidebarController
        let editor = splitController.editorController

        sidebar.onSelectDocument = { [weak self] id in self?.selectDocument(id: id) }
        sidebar.onCreateDocument = { [weak self] in self?.createDocument() }
        sidebar.onOpenDocuments = { [weak self] in self?.chooseDocumentsToOpen() }
        sidebar.onOpenFolder = { [weak self] in self?.chooseFolderToOpen() }
        sidebar.onOpenWorkspaceFile = { [weak self] url in self?.openWorkspaceFile(url: url) }
        sidebar.onCloseDocument = { [weak self] id in self?.closeDocument(id: id) }
        sidebar.onRevealDocument = { [weak self] id in self?.revealDocument(id: id) }
        sidebar.onRevealFileURL = { url in NSWorkspace.shared.activateFileViewerSelecting([url]) }

        editor.onSelectTab = { [weak self] id in self?.selectDocument(id: id) }
        editor.onCloseTab = { [weak self] id in self?.closeDocument(id: id) }
        editor.onCreateDocument = { [weak self] in self?.createDocument() }
        editor.onOpenDocuments = { [weak self] in self?.chooseDocumentsToOpen() }
        editor.onOpenFolder = { [weak self] in self?.chooseFolderToOpen() }
        editor.onShowError = { [weak self] message in self?.showError(message) }
    }

    private func selectDocument(id: String) {
        guard store.activeDocumentID != id else { return }
        flushEditor { [weak self] success in
            guard let self, success else { return }
            store.selectDocument(id: id)
            splitController.editorController.reload(forceEditor: true)
            splitController.editorController.focusEditor()
        }
    }

    private func openWorkspaceFile(url: URL) {
        if let document = store.document(for: url) {
            selectDocument(id: document.id)
            return
        }
        flushEditor { [weak self] success in
            guard let self, success else { return }
            Task {
                do {
                    _ = try await store.open(url: url)
                    splitController.editorController.reload(forceEditor: true)
                    splitController.editorController.focusEditor()
                } catch {
                    showError("无法打开 \(url.lastPathComponent)：\(error.localizedDescription)")
                }
            }
        }
    }

    private func updateWindowTitle() {
        window?.title = store.activeDocument?.displayTitle ?? "鹅的笔记"
        window?.representedURL = store.activeDocument?.fileURL
    }

    @objc private func toolbarToggleSidebar(_ sender: Any?) { toggleSidebar() }
}
