import AppKit

@MainActor
final class TabStripView: NSView {
    var onSelect: ((String) -> Void)?
    var onClose: ((String) -> Void)?

    private let stack = NSStackView()
    private let scrollView = NSScrollView()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        stack.orientation = .horizontal
        stack.spacing = 3
        stack.alignment = .centerY
        stack.edgeInsets = NSEdgeInsets(top: 4, left: 6, bottom: 4, right: 6)

        scrollView.documentView = stack
        scrollView.hasHorizontalScroller = false
        scrollView.hasVerticalScroller = false
        scrollView.drawsBackground = false
        scrollView.horizontalScrollElasticity = .automatic
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scrollView)
        NSLayoutConstraint.activate([
            scrollView.leadingAnchor.constraint(equalTo: leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.heightAnchor.constraint(equalTo: scrollView.contentView.heightAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func reload(documents: [MarkdownDocument], activeDocumentID: String?) {
        stack.arrangedSubviews.forEach { view in
            stack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        for document in documents {
            stack.addArrangedSubview(makeTab(document: document, active: document.id == activeDocumentID))
        }
    }

    private func makeTab(document: MarkdownDocument, active: Bool) -> NSView {
        let container = NSView()
        container.wantsLayer = true
        container.layer?.cornerRadius = DesignTokens.Radius.small
        container.layer?.backgroundColor = active ? DesignTokens.Color.surfaceRaised.cgColor : NSColor.clear.cgColor

        let select = DocumentTabButton(title: document.displayTitle, target: self, action: #selector(selectTab(_:)))
        select.documentID = document.id
        select.isBordered = false
        select.bezelStyle = .inline
        select.font = .systemFont(ofSize: 12.5, weight: active ? .medium : .regular)
        select.contentTintColor = DesignTokens.Color.textPrimary
        select.toolTip = document.fileURL.path
        select.setAccessibilityLabel(document.displayTitle)

        let close = DocumentTabButton(title: "", target: self, action: #selector(closeTab(_:)))
        close.documentID = document.id
        close.isBordered = false
        close.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "关闭文件")
        close.image?.isTemplate = true
        close.toolTip = "关闭文件"
        close.contentTintColor = DesignTokens.Color.textSecondary

        for item in [select, close] {
            item.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(item)
        }
        NSLayoutConstraint.activate([
            select.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 8),
            select.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            select.widthAnchor.constraint(lessThanOrEqualToConstant: 190),
            close.leadingAnchor.constraint(equalTo: select.trailingAnchor, constant: 2),
            close.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -5),
            close.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            close.widthAnchor.constraint(equalToConstant: 18),
            container.heightAnchor.constraint(equalToConstant: 28),
        ])
        return container
    }

    @objc private func selectTab(_ sender: DocumentTabButton) {
        if let id = sender.documentID { onSelect?(id) }
    }

    @objc private func closeTab(_ sender: DocumentTabButton) {
        if let id = sender.documentID { onClose?(id) }
    }
}

private final class DocumentTabButton: NSButton {
    var documentID: String?
}
