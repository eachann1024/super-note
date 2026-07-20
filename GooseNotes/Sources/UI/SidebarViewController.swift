import AppKit

@MainActor
final class SidebarViewController: NSViewController, NSTableViewDataSource, NSTableViewDelegate,
    NSSearchFieldDelegate, NSMenuDelegate {

    var onSelectDocument: ((String) -> Void)?
    var onCreateDocument: (() -> Void)?
    var onOpenDocuments: (() -> Void)?
    var onOpenFolder: (() -> Void)?
    var onOpenWorkspaceFile: ((URL) -> Void)?
    var onCloseDocument: ((String) -> Void)?
    var onRevealDocument: ((String) -> Void)?
    var onRevealFileURL: ((URL) -> Void)?

    private let store: DocumentStore
    private let searchField = NSSearchField()
    private let folderButton = NSButton()
    private let tableView = NSTableView()
    private let scrollView = NSScrollView()
    private let emptyLabel = NSTextField(labelWithString: "")
    private let observerTokens = NotificationTokenBag()
    private var visibleDocuments: [MarkdownDocument] = []
    private var visibleWorkspaceFiles: [MarkdownWorkspaceFile] = []
    private var isApplyingSelection = false

    init(store: DocumentStore) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() {
        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = DesignTokens.Color.sidebar.cgColor
        view = root

        folderButton.title = "打开文件夹"
        folderButton.image = NSImage(systemSymbolName: "folder", accessibilityDescription: nil)
        folderButton.imagePosition = .imageLeading
        folderButton.alignment = .left
        folderButton.isBordered = false
        folderButton.font = .systemFont(ofSize: 14, weight: .semibold)
        folderButton.contentTintColor = DesignTokens.Color.textPrimary
        folderButton.target = self
        folderButton.action = #selector(openFolder(_:))
        folderButton.toolTip = "打开 Markdown 文件夹（⇧⌘O）"
        folderButton.setAccessibilityLabel("打开 Markdown 文件夹")

        searchField.placeholderString = "搜索 Markdown 文件"
        searchField.sendsSearchStringImmediately = true
        searchField.delegate = self
        searchField.setAccessibilityLabel("搜索已打开文件")

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("document"))
        column.resizingMask = .autoresizingMask
        tableView.addTableColumn(column)
        tableView.headerView = nil
        tableView.rowHeight = 34
        tableView.style = .sourceList
        tableView.dataSource = self
        tableView.delegate = self
        tableView.setAccessibilityLabel("已打开的 Markdown 文件")

        let menu = NSMenu()
        menu.delegate = self
        tableView.menu = menu

        scrollView.documentView = tableView
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false

        emptyLabel.stringValue = "没有已打开的文件"
        emptyLabel.alignment = .center
        emptyLabel.textColor = DesignTokens.Color.textSecondary
        emptyLabel.font = .systemFont(ofSize: 13)

        let newButton = NSButton(title: "新建", target: self, action: #selector(createDocument(_:)))
        newButton.image = NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: nil)
        newButton.imagePosition = .imageLeading
        newButton.toolTip = "新建 Markdown 文件（⌘N）"

        let openButton = NSButton(title: "文件", target: self, action: #selector(openDocuments(_:)))
        openButton.image = NSImage(systemSymbolName: "folder", accessibilityDescription: nil)
        openButton.imagePosition = .imageLeading
        openButton.toolTip = "打开 Markdown 文件（⌘O）"

        let folderActionButton = NSButton(title: "文件夹", target: self, action: #selector(openFolder(_:)))
        folderActionButton.image = NSImage(systemSymbolName: "folder.badge.plus", accessibilityDescription: nil)
        folderActionButton.imagePosition = .imageLeading
        folderActionButton.toolTip = "打开 Markdown 文件夹（⇧⌘O）"

        let actions = NSStackView(views: [newButton, openButton, folderActionButton])
        actions.orientation = .horizontal
        actions.distribution = .fillEqually
        actions.spacing = DesignTokens.Space.sm

        for item in [folderButton, searchField, scrollView, emptyLabel, actions] {
            item.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(item)
        }
        NSLayoutConstraint.activate([
            folderButton.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor, constant: DesignTokens.Space.sm),
            folderButton.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: DesignTokens.Space.sm),
            folderButton.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -DesignTokens.Space.sm),
            folderButton.heightAnchor.constraint(equalToConstant: 30),

            searchField.topAnchor.constraint(equalTo: folderButton.bottomAnchor, constant: DesignTokens.Space.sm),
            searchField.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: DesignTokens.Space.md),
            searchField.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -DesignTokens.Space.md),

            scrollView.topAnchor.constraint(equalTo: searchField.bottomAnchor, constant: DesignTokens.Space.sm),
            scrollView.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: DesignTokens.Space.xs),
            scrollView.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -DesignTokens.Space.xs),
            scrollView.bottomAnchor.constraint(equalTo: actions.topAnchor, constant: -DesignTokens.Space.sm),

            emptyLabel.centerXAnchor.constraint(equalTo: scrollView.centerXAnchor),
            emptyLabel.centerYAnchor.constraint(equalTo: scrollView.centerYAnchor),

            actions.leadingAnchor.constraint(equalTo: searchField.leadingAnchor),
            actions.trailingAnchor.constraint(equalTo: searchField.trailingAnchor),
            actions.bottomAnchor.constraint(equalTo: root.safeAreaLayoutGuide.bottomAnchor, constant: -DesignTokens.Space.md),
            actions.heightAnchor.constraint(equalToConstant: 30),
        ])

        observerTokens.values.append(NotificationCenter.default.addObserver(
            forName: .documentsDidChange, object: store, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.reload() } })
        reload()
    }

    func focusSearch() {
        view.window?.makeFirstResponder(searchField)
        searchField.selectText(nil)
    }

    func reload() {
        guard isViewLoaded else { return }
        visibleWorkspaceFiles = store.filteredWorkspaceFiles(query: searchField.stringValue)
        visibleDocuments = store.filteredDocuments(query: searchField.stringValue)
        folderButton.title = store.workspace?.displayName ?? "打开文件夹"
        folderButton.image = NSImage(
            systemSymbolName: store.workspace == nil ? "folder.badge.plus" : "folder.fill",
            accessibilityDescription: nil
        )
        searchField.placeholderString = store.workspace == nil ? "搜索已打开文件" : "搜索文件夹中的 Markdown"
        tableView.setAccessibilityLabel(store.workspace == nil ? "已打开的 Markdown 文件" : "文件夹中的 Markdown 文件")
        tableView.rowHeight = store.workspace == nil ? 34 : 38
        isApplyingSelection = true
        tableView.reloadData()
        if let activeURL = store.activeDocument?.fileURL,
           store.workspace != nil,
           let row = visibleWorkspaceFiles.firstIndex(where: {
               $0.fileURL.standardizedFileURL == activeURL.standardizedFileURL
           }) {
            tableView.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
            tableView.scrollRowToVisible(row)
        } else if let activeID = store.activeDocumentID,
                  let row = visibleDocuments.firstIndex(where: { $0.id == activeID }) {
            tableView.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
            tableView.scrollRowToVisible(row)
        } else {
            tableView.deselectAll(nil)
        }
        isApplyingSelection = false
        let isEmpty = store.workspace == nil ? visibleDocuments.isEmpty : visibleWorkspaceFiles.isEmpty
        emptyLabel.stringValue = store.workspace == nil
            ? "没有已打开的文件"
            : (searchField.stringValue.isEmpty ? "这个文件夹中没有 Markdown 文件" : "没有找到匹配的文件")
        emptyLabel.isHidden = !isEmpty
        scrollView.isHidden = isEmpty
    }

    func numberOfRows(in tableView: NSTableView) -> Int {
        store.workspace == nil ? visibleDocuments.count : visibleWorkspaceFiles.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard row >= 0, row < numberOfRows(in: tableView) else { return nil }
        let identifier = NSUserInterfaceItemIdentifier("DocumentCell")
        let cell = (tableView.makeView(withIdentifier: identifier, owner: self) as? NSTableCellView)
            ?? makeCell(identifier: identifier)
        if store.workspace != nil {
            let file = visibleWorkspaceFiles[row]
            cell.textField?.stringValue = file.relativePath
            cell.textField?.font = store.activeDocument?.fileURL.standardizedFileURL == file.fileURL.standardizedFileURL
                ? .systemFont(ofSize: 13, weight: .medium)
                : .systemFont(ofSize: 13)
            cell.toolTip = file.fileURL.path
        } else {
            let document = visibleDocuments[row]
            cell.textField?.stringValue = document.displayTitle
            cell.textField?.font = document.id == store.activeDocumentID
                ? .systemFont(ofSize: 13, weight: .medium)
                : .systemFont(ofSize: 13)
            cell.toolTip = document.fileURL.path
        }
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard !isApplyingSelection else { return }
        let row = tableView.selectedRow
        if store.workspace != nil {
            guard visibleWorkspaceFiles.indices.contains(row) else { return }
            onOpenWorkspaceFile?(visibleWorkspaceFiles[row].fileURL)
        } else {
            guard visibleDocuments.indices.contains(row) else { return }
            onSelectDocument?(visibleDocuments[row].id)
        }
    }

    func controlTextDidChange(_ obj: Notification) {
        guard obj.object as? NSSearchField === searchField else { return }
        reload()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        guard tableView.clickedRow >= 0, tableView.clickedRow < numberOfRows(in: tableView) else { return }
        tableView.selectRowIndexes(IndexSet(integer: tableView.clickedRow), byExtendingSelection: false)
        let reveal = menu.addItem(withTitle: "在 Finder 中显示", action: #selector(revealDocument(_:)), keyEquivalent: "")
        reveal.target = self
        if selectedDocumentID() != nil {
            let close = menu.addItem(withTitle: "关闭文件", action: #selector(closeDocument(_:)), keyEquivalent: "")
            close.target = self
        }
    }

    private func selectedDocumentID() -> String? {
        let row = tableView.selectedRow
        if store.workspace != nil {
            guard visibleWorkspaceFiles.indices.contains(row) else { return nil }
            return store.document(for: visibleWorkspaceFiles[row].fileURL)?.id
        }
        return visibleDocuments.indices.contains(row) ? visibleDocuments[row].id : nil
    }

    private func selectedFileURL() -> URL? {
        let row = tableView.selectedRow
        if store.workspace != nil {
            return visibleWorkspaceFiles.indices.contains(row) ? visibleWorkspaceFiles[row].fileURL : nil
        }
        return visibleDocuments.indices.contains(row) ? visibleDocuments[row].fileURL : nil
    }

    private func makeCell(identifier: NSUserInterfaceItemIdentifier) -> NSTableCellView {
        let cell = NSTableCellView()
        cell.identifier = identifier
        let icon = NSImageView(image: NSImage(systemSymbolName: "doc.text", accessibilityDescription: nil) ?? NSImage())
        icon.contentTintColor = DesignTokens.Color.textSecondary
        let label = NSTextField(labelWithString: "")
        label.lineBreakMode = .byTruncatingMiddle
        label.textColor = DesignTokens.Color.textPrimary
        cell.imageView = icon
        cell.textField = label
        for item in [icon, label] {
            item.translatesAutoresizingMaskIntoConstraints = false
            cell.addSubview(item)
        }
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 4),
            icon.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 16),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 7),
            label.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -6),
            label.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
        ])
        return cell
    }

    @objc private func createDocument(_ sender: Any?) { onCreateDocument?() }
    @objc private func openDocuments(_ sender: Any?) { onOpenDocuments?() }
    @objc private func openFolder(_ sender: Any?) { onOpenFolder?() }
    @objc private func closeDocument(_ sender: Any?) {
        if let id = selectedDocumentID() { onCloseDocument?(id) }
    }
    @objc private func revealDocument(_ sender: Any?) {
        if let id = selectedDocumentID() {
            onRevealDocument?(id)
        } else if let url = selectedFileURL() {
            onRevealFileURL?(url)
        }
    }
}
