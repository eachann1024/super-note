import AppKit

final class NotificationTokenBag: @unchecked Sendable {
    var values: [NSObjectProtocol] = []

    deinit {
        for value in values { NotificationCenter.default.removeObserver(value) }
    }
}

@MainActor
final class EditorContainerViewController: NSViewController {
    var onSelectTab: ((String) -> Void)?
    var onCloseTab: ((String) -> Void)?
    var onCreateDocument: (() -> Void)?
    var onOpenDocuments: (() -> Void)?
    var onOpenFolder: (() -> Void)?
    var onShowError: ((String) -> Void)?

    private let store: DocumentStore
    private let preferences: AppPreferences
    private let webController: EditorWebViewController
    private let tabStrip = TabStripView()
    private let saveLabel = NSTextField(labelWithString: "")
    private let moreButton = NSPopUpButton()
    private let editorHost = NSView()
    private let emptyState = NSView()
    private let observerTokens = NotificationTokenBag()
    private var lastAnnouncedSaveMessage: String?

    init(store: DocumentStore, preferences: AppPreferences = .shared) {
        self.store = store
        self.preferences = preferences
        webController = EditorWebViewController(store: store, preferences: preferences)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() {
        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = DesignTokens.Color.canvas.cgColor
        view = root

        let topBar = NSView()
        topBar.wantsLayer = true
        topBar.layer?.backgroundColor = DesignTokens.Color.sidebar.cgColor

        saveLabel.font = .systemFont(ofSize: 12)
        saveLabel.textColor = DesignTokens.Color.textSecondary
        saveLabel.alignment = .right
        saveLabel.setAccessibilityElement(true)
        saveLabel.setAccessibilityRole(.staticText)
        saveLabel.setAccessibilityLabel("保存状态")

        moreButton.isBordered = false
        moreButton.image = NSImage(systemSymbolName: "ellipsis", accessibilityDescription: "更多文件操作")
        moreButton.menu = makeMoreMenu()
        moreButton.toolTip = "更多文件操作"

        tabStrip.onSelect = { [weak self] id in self?.onSelectTab?(id) }
        tabStrip.onClose = { [weak self] id in self?.onCloseTab?(id) }

        let actions = NSStackView(views: [saveLabel, moreButton])
        actions.orientation = .horizontal
        actions.alignment = .centerY
        actions.spacing = 5
        saveLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        for item in [tabStrip, actions] {
            item.translatesAutoresizingMaskIntoConstraints = false
            topBar.addSubview(item)
        }
        NSLayoutConstraint.activate([
            tabStrip.leadingAnchor.constraint(equalTo: topBar.leadingAnchor),
            tabStrip.topAnchor.constraint(equalTo: topBar.topAnchor),
            tabStrip.bottomAnchor.constraint(equalTo: topBar.bottomAnchor),
            tabStrip.trailingAnchor.constraint(equalTo: actions.leadingAnchor, constant: -6),
            actions.trailingAnchor.constraint(equalTo: topBar.trailingAnchor, constant: -8),
            actions.centerYAnchor.constraint(equalTo: topBar.centerYAnchor),
            actions.widthAnchor.constraint(lessThanOrEqualToConstant: 180),
        ])

        addChild(webController)
        let webView = webController.view
        webView.translatesAutoresizingMaskIntoConstraints = false
        editorHost.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: editorHost.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: editorHost.trailingAnchor),
            webView.topAnchor.constraint(equalTo: editorHost.topAnchor),
            webView.bottomAnchor.constraint(equalTo: editorHost.bottomAnchor),
        ])
        webController.onLoadFailure = { [weak self] message in self?.onShowError?(message) }

        let emptyIcon = NSImageView(image: NSImage(systemSymbolName: "doc.text", accessibilityDescription: nil) ?? NSImage())
        emptyIcon.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 38, weight: .light)
        emptyIcon.contentTintColor = DesignTokens.Color.accent
        let emptyTitle = NSTextField(labelWithString: "打开本地 Markdown 文件开始写作")
        emptyTitle.font = .systemFont(ofSize: 18, weight: .semibold)
        emptyTitle.textColor = DesignTokens.Color.textPrimary
        let emptyBody = NSTextField(labelWithString: "内容会直接保存到磁盘上的 .md 文件，不会写入应用数据库。")
        emptyBody.font = .systemFont(ofSize: 13)
        emptyBody.textColor = DesignTokens.Color.textSecondary

        let newButton = NSButton(title: "新建文件", target: self, action: #selector(createDocument(_:)))
        newButton.bezelStyle = .rounded
        newButton.keyEquivalent = "\r"
        let openButton = NSButton(title: "打开文件", target: self, action: #selector(openDocuments(_:)))
        openButton.bezelStyle = .rounded
        let openFolderButton = NSButton(title: "打开文件夹", target: self, action: #selector(openFolder(_:)))
        openFolderButton.bezelStyle = .rounded
        let buttons = NSStackView(views: [newButton, openButton, openFolderButton])
        buttons.orientation = .horizontal
        buttons.spacing = DesignTokens.Space.sm

        let emptyStack = NSStackView(views: [emptyIcon, emptyTitle, emptyBody, buttons])
        emptyStack.orientation = .vertical
        emptyStack.alignment = .centerX
        emptyStack.spacing = 10
        emptyStack.setCustomSpacing(18, after: emptyBody)
        emptyStack.translatesAutoresizingMaskIntoConstraints = false
        emptyState.addSubview(emptyStack)
        NSLayoutConstraint.activate([
            emptyStack.centerXAnchor.constraint(equalTo: emptyState.centerXAnchor),
            emptyStack.centerYAnchor.constraint(equalTo: emptyState.centerYAnchor, constant: -20),
        ])

        for item in [topBar, editorHost, emptyState] {
            item.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(item)
        }
        NSLayoutConstraint.activate([
            topBar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            topBar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            topBar.topAnchor.constraint(equalTo: root.topAnchor),
            topBar.heightAnchor.constraint(equalToConstant: 38),
            editorHost.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            editorHost.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            editorHost.topAnchor.constraint(equalTo: topBar.bottomAnchor),
            editorHost.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            emptyState.leadingAnchor.constraint(equalTo: editorHost.leadingAnchor),
            emptyState.trailingAnchor.constraint(equalTo: editorHost.trailingAnchor),
            emptyState.topAnchor.constraint(equalTo: editorHost.topAnchor),
            emptyState.bottomAnchor.constraint(equalTo: editorHost.bottomAnchor),
        ])

        observerTokens.values.append(NotificationCenter.default.addObserver(
            forName: .documentsDidChange, object: store, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.reload() } })
        observerTokens.values.append(NotificationCenter.default.addObserver(
            forName: .saveStateDidChange, object: store, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.updateSaveState() } })
        observerTokens.values.append(NotificationCenter.default.addObserver(
            forName: .preferencesDidChange, object: preferences, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.webController.sendPreferences() } })
        reload()
    }

    func reload(forceEditor: Bool = false) {
        guard isViewLoaded else { return }
        tabStrip.reload(documents: store.documents, activeDocumentID: store.activeDocumentID)
        updateSaveState()
        if let document = store.activeDocument {
            editorHost.isHidden = false
            emptyState.isHidden = true
            moreButton.isEnabled = true
            webController.present(page: document, force: forceEditor)
        } else {
            editorHost.isHidden = true
            emptyState.isHidden = false
            moreButton.isEnabled = false
            webController.clear()
        }
    }

    func flush(completion: @escaping (Bool) -> Void) {
        webController.flush(completion: completion)
    }

    func dispatchEditorCommand(_ command: String) { webController.dispatch(command: command) }
    func printEditor() { webController.printEditor() }
    func focusEditor() { webController.focusEditor() }

    private func updateSaveState() {
        let announcement: String?
        switch store.saveState {
        case .idle:
            saveLabel.stringValue = ""
            saveLabel.textColor = DesignTokens.Color.textSecondary
            announcement = nil
        case .saving:
            saveLabel.stringValue = "正在写入文件…"
            saveLabel.textColor = DesignTokens.Color.textSecondary
            announcement = "正在写入文件"
        case .saved:
            saveLabel.stringValue = "已保存到磁盘"
            saveLabel.textColor = DesignTokens.Color.success
            announcement = "已保存到磁盘"
        case .failed:
            saveLabel.stringValue = "保存失败"
            saveLabel.textColor = DesignTokens.Color.destructive
            announcement = "保存失败"
        }
        guard let announcement, announcement != lastAnnouncedSaveMessage else { return }
        lastAnnouncedSaveMessage = announcement
        NSAccessibility.post(
            element: NSApp!,
            notification: .announcementRequested,
            userInfo: [
                .announcement: announcement,
                .priority: NSAccessibilityPriorityLevel.medium.rawValue,
            ]
        )
    }

    private func makeMoreMenu() -> NSMenu {
        let menu = NSMenu()
        let reveal = menu.addItem(withTitle: "在 Finder 中显示", action: #selector(revealFromMenu(_:)), keyEquivalent: "")
        reveal.target = self
        let printItem = menu.addItem(withTitle: "打印…", action: #selector(printFromMenu(_:)), keyEquivalent: "")
        printItem.target = self
        return menu
    }

    @objc private func createDocument(_ sender: Any?) { onCreateDocument?() }
    @objc private func openDocuments(_ sender: Any?) { onOpenDocuments?() }
    @objc private func openFolder(_ sender: Any?) { onOpenFolder?() }
    @objc private func revealFromMenu(_ sender: Any?) {
        NSApp.sendAction(#selector(AppDelegate.revealActiveDocument(_:)), to: nil, from: sender)
    }
    @objc private func printFromMenu(_ sender: Any?) { printEditor() }
}
