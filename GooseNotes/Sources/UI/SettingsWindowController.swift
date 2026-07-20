import AppKit

@MainActor
final class SettingsWindowController: NSWindowController {
    private let preferences: AppPreferences
    private let appearancePopup = NSPopUpButton()
    private let fontPopup = NSPopUpButton()
    private let fullWidthSwitch = NSSwitch()
    private let defaultApplicationService = MarkdownDefaultApplicationService()
    private let defaultApplicationStatus = NSTextField(wrappingLabelWithString: "")
    private let defaultApplicationButton = NSButton()

    init(preferences: AppPreferences = .shared) {
        self.preferences = preferences
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 350),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "设置"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        setup()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func setup() {
        guard let content = window?.contentView else { return }
        let title = NSTextField(labelWithString: "外观与阅读")
        title.font = .systemFont(ofSize: 18, weight: .semibold)
        title.textColor = DesignTokens.Color.textPrimary

        for mode in AppearanceMode.allCases {
            appearancePopup.addItem(withTitle: mode.title)
            appearancePopup.lastItem?.representedObject = mode.rawValue
        }
        appearancePopup.selectItem(withTitle: preferences.appearanceMode.title)
        appearancePopup.target = self
        appearancePopup.action = #selector(appearanceChanged(_:))

        for mode in EditorFontMode.allCases {
            fontPopup.addItem(withTitle: mode.title)
            fontPopup.lastItem?.representedObject = mode.rawValue
        }
        fontPopup.selectItem(withTitle: preferences.editorFontMode.title)
        fontPopup.target = self
        fontPopup.action = #selector(fontChanged(_:))

        fullWidthSwitch.state = preferences.editorFullWidth ? .on : .off
        fullWidthSwitch.target = self
        fullWidthSwitch.action = #selector(fullWidthChanged(_:))

        let grid = NSGridView(views: [
            [NSTextField(labelWithString: "界面外观"), appearancePopup],
            [NSTextField(labelWithString: "正文字体"), fontPopup],
            [NSTextField(labelWithString: "使用宽版编辑器"), fullWidthSwitch],
        ])
        grid.rowSpacing = 14
        grid.columnSpacing = 20
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).xPlacement = .leading

        let note = NSTextField(wrappingLabelWithString: "界面字体始终使用系统字体。正文设置只影响笔记编辑器。")
        note.textColor = DesignTokens.Color.textSecondary
        note.font = .systemFont(ofSize: 12)

        let defaultApplicationTitle = NSTextField(labelWithString: "默认应用")
        defaultApplicationTitle.font = .systemFont(ofSize: 15, weight: .semibold)
        defaultApplicationTitle.textColor = DesignTokens.Color.textPrimary

        defaultApplicationStatus.textColor = DesignTokens.Color.textSecondary
        defaultApplicationStatus.font = .systemFont(ofSize: 12)
        defaultApplicationButton.title = "设为 Markdown 默认应用"
        defaultApplicationButton.bezelStyle = .rounded
        defaultApplicationButton.target = self
        defaultApplicationButton.action = #selector(setAsDefaultApplication(_:))

        let defaultApplicationStack = NSStackView(views: [defaultApplicationTitle, defaultApplicationStatus, defaultApplicationButton])
        defaultApplicationStack.orientation = .vertical
        defaultApplicationStack.alignment = .leading
        defaultApplicationStack.spacing = 8

        let stack = NSStackView(views: [title, grid, note, defaultApplicationStack])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 26),
            note.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        updateDefaultApplicationStatus()
        window?.center()
    }

    override func showWindow(_ sender: Any?) {
        updateDefaultApplicationStatus()
        super.showWindow(sender)
    }

    @objc private func appearanceChanged(_ sender: NSPopUpButton) {
        guard let raw = sender.selectedItem?.representedObject as? String,
              let mode = AppearanceMode(rawValue: raw) else { return }
        preferences.appearanceMode = mode
        NSApp.appearance = mode.appearance
    }

    @objc private func fontChanged(_ sender: NSPopUpButton) {
        guard let raw = sender.selectedItem?.representedObject as? String,
              let mode = EditorFontMode(rawValue: raw) else { return }
        preferences.editorFontMode = mode
    }

    @objc private func fullWidthChanged(_ sender: NSSwitch) {
        preferences.editorFullWidth = sender.state == .on
    }

    @objc private func setAsDefaultApplication(_ sender: NSButton) {
        defaultApplicationButton.isEnabled = false
        defaultApplicationStatus.stringValue = "正在请求系统设置…"
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await defaultApplicationService.setCurrentApplicationAsDefault()
                updateDefaultApplicationStatus()
            } catch {
                defaultApplicationButton.isEnabled = true
                defaultApplicationStatus.stringValue = "设置失败：\(error.localizedDescription)"
                let alert = NSAlert()
                alert.alertStyle = .warning
                alert.messageText = "无法设置默认应用"
                alert.informativeText = error.localizedDescription
                if let window {
                    await alert.beginSheetModal(for: window)
                }
            }
        }
    }

    private func updateDefaultApplicationStatus() {
        let isDefault = defaultApplicationService.isCurrentApplicationDefault
        defaultApplicationStatus.stringValue = isDefault
            ? "鹅的笔记当前是 .md 与 .markdown 文件的默认应用。"
            : "可由系统确认后，将鹅的笔记设为 Markdown 文件的默认应用。"
        defaultApplicationButton.title = isDefault ? "已设为默认应用" : "设为 Markdown 默认应用"
        defaultApplicationButton.isEnabled = !isDefault
    }
}
