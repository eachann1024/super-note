import AppKit

@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    private let preferences = AppPreferences.shared
    private let store = DocumentStore()
    private var mainWindowController: MainWindowController?
    private var settingsWindowController: SettingsWindowController?
    private var pendingOpenURLs: [URL] = []
    private var terminationInProgress = false

    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        buildMainMenu()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = preferences.appearanceMode.appearance
        let controller = MainWindowController(store: store)
        mainWindowController = controller
        controller.show()
        if !pendingOpenURLs.isEmpty {
            let urls = pendingOpenURLs
            pendingOpenURLs.removeAll()
            controller.openDocuments(urls: urls)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { mainWindowController?.show() }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    func application(_ application: NSApplication, open urls: [URL]) {
        let markdownURLs = urls.filter(MarkdownFileType.supports)
        guard !markdownURLs.isEmpty else { return }
        if let mainWindowController {
            mainWindowController.openDocuments(urls: markdownURLs)
        } else {
            pendingOpenURLs.append(contentsOf: markdownURLs)
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminationInProgress else { return .terminateLater }
        guard let controller = mainWindowController else { return .terminateNow }
        terminationInProgress = true
        controller.flushEditor { [weak self] success in
            guard let self else {
                sender.reply(toApplicationShouldTerminate: false)
                return
            }
            guard success else {
                terminationInProgress = false
                controller.showError("退出前保存失败，请处理后重试。")
                sender.reply(toApplicationShouldTerminate: false)
                return
            }
            store.stopAccessingFiles()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    @IBAction func newDocument(_ sender: Any?) { mainWindowController?.createDocument() }
    @IBAction func openDocument(_ sender: Any?) { mainWindowController?.chooseDocumentsToOpen() }
    @IBAction func openFolder(_ sender: Any?) { mainWindowController?.chooseFolderToOpen() }
    @IBAction func saveDocument(_ sender: Any?) { mainWindowController?.saveActiveDocument() }
    @IBAction func closeDocument(_ sender: Any?) { mainWindowController?.closeActiveDocument() }
    @IBAction func revealActiveDocument(_ sender: Any?) { mainWindowController?.revealActiveDocument() }
    @IBAction func focusSearch(_ sender: Any?) { mainWindowController?.focusSearch() }
    @IBAction func toggleSidebar(_ sender: Any?) { mainWindowController?.toggleSidebar() }
    @IBAction func printDocument(_ sender: Any?) { mainWindowController?.printEditor() }

    @IBAction func showSettings(_ sender: Any?) {
        if settingsWindowController == nil {
            settingsWindowController = SettingsWindowController(preferences: preferences)
        }
        settingsWindowController?.showWindow(sender)
        settingsWindowController?.window?.makeKeyAndOrderFront(sender)
        NSApp.activate(ignoringOtherApps: true)
    }

    @IBAction func applyAppearance(_ sender: NSMenuItem) {
        guard let rawValue = sender.representedObject as? String,
              let mode = AppearanceMode(rawValue: rawValue) else { return }
        preferences.appearanceMode = mode
        NSApp.appearance = mode.appearance
        updateAppearanceMenuState()
    }

    @IBAction func formatEditor(_ sender: NSMenuItem) {
        guard let command = sender.representedObject as? String else { return }
        mainWindowController?.dispatchEditorCommand(command)
    }

    @IBAction func openHelp(_ sender: Any?) {
        guard let url = URL(string: "https://github.com/eachann1024/super-note") else { return }
        NSWorkspace.shared.open(url)
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        switch menuItem.action {
        case #selector(saveDocument(_:)), #selector(closeDocument(_:)), #selector(revealActiveDocument(_:)),
             #selector(printDocument(_:)), #selector(formatEditor(_:)):
            return store.activeDocument != nil
        default:
            return true
        }
    }

    private func buildMainMenu() {
        let mainMenu = NSMenu()
        NSApp.mainMenu = mainMenu

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu(title: "鹅的笔记")
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于鹅的笔记", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "设置…", action: #selector(showSettings(_:)), keyEquivalent: ",").target = self
        appMenu.addItem(.separator())
        let services = NSMenuItem(title: "服务", action: nil, keyEquivalent: "")
        services.submenu = NSMenu()
        appMenu.addItem(services)
        NSApp.servicesMenu = services.submenu
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏鹅的笔记", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出鹅的笔记", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileMenu = addTopLevelMenu("文件", to: mainMenu)
        addItem("新建 Markdown 文件…", to: fileMenu, action: #selector(newDocument(_:)), key: "n", target: self)
        addItem("打开文件…", to: fileMenu, action: #selector(openDocument(_:)), key: "o", target: self)
        let openFolder = addItem("打开文件夹…", to: fileMenu, action: #selector(openFolder(_:)), key: "o", target: self)
        openFolder.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(.separator())
        addItem("保存", to: fileMenu, action: #selector(saveDocument(_:)), key: "s", target: self)
        addItem("关闭文件", to: fileMenu, action: #selector(closeDocument(_:)), key: "w", target: self)
        addItem("在 Finder 中显示", to: fileMenu, action: #selector(revealActiveDocument(_:)), key: "", target: self)
        fileMenu.addItem(.separator())
        let closeWindow = addItem("关闭窗口", to: fileMenu, action: #selector(NSWindow.performClose(_:)), key: "w", target: nil)
        closeWindow.keyEquivalentModifierMask = [.command, .shift]
        addItem("打印…", to: fileMenu, action: #selector(printDocument(_:)), key: "p", target: self)

        let editMenu = addTopLevelMenu("编辑", to: mainMenu)
        addItem("撤销", to: editMenu, action: Selector(("undo:")), key: "z", target: nil)
        let redo = addItem("重做", to: editMenu, action: Selector(("redo:")), key: "Z", target: nil)
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        addItem("剪切", to: editMenu, action: #selector(NSText.cut(_:)), key: "x", target: nil)
        addItem("复制", to: editMenu, action: #selector(NSText.copy(_:)), key: "c", target: nil)
        addItem("粘贴", to: editMenu, action: #selector(NSText.paste(_:)), key: "v", target: nil)
        addItem("全选", to: editMenu, action: #selector(NSText.selectAll(_:)), key: "a", target: nil)
        editMenu.addItem(.separator())
        addItem("搜索已打开文件…", to: editMenu, action: #selector(focusSearch(_:)), key: "k", target: self)

        let formatMenu = addTopLevelMenu("格式", to: mainMenu)
        addFormatItem("粗体", command: "bold", key: "b", to: formatMenu)
        addFormatItem("斜体", command: "italic", key: "i", to: formatMenu)
        addFormatItem("删除线", command: "strike", key: "x", modifiers: [.command, .shift], to: formatMenu)
        addFormatItem("行内代码", command: "code", key: "`", to: formatMenu)
        addFormatItem("插入链接", command: "link", key: "k", to: formatMenu)
        formatMenu.addItem(.separator())
        addFormatItem("标题 1", command: "heading1", key: "1", modifiers: [.command, .shift], to: formatMenu)
        addFormatItem("标题 2", command: "heading2", key: "2", modifiers: [.command, .shift], to: formatMenu)
        addFormatItem("标题 3", command: "heading3", key: "3", modifiers: [.command, .shift], to: formatMenu)
        formatMenu.addItem(.separator())
        addFormatItem("项目列表", command: "bulletList", key: "7", modifiers: [.command, .shift], to: formatMenu)
        addFormatItem("编号列表", command: "numberedList", key: "9", modifiers: [.command, .shift], to: formatMenu)
        addFormatItem("待办列表", command: "checkList", key: "l", modifiers: [.command, .shift], to: formatMenu)
        addFormatItem("引用", command: "blockquote", key: "'", to: formatMenu)

        let viewMenu = addTopLevelMenu("显示", to: mainMenu)
        let appearanceItem = NSMenuItem(title: "外观", action: nil, keyEquivalent: "")
        let appearanceMenu = NSMenu(title: "外观")
        for mode in AppearanceMode.allCases {
            let item = appearanceMenu.addItem(withTitle: mode.title, action: #selector(applyAppearance(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = mode.rawValue
            item.identifier = NSUserInterfaceItemIdentifier("appearance.\(mode.rawValue)")
        }
        appearanceItem.submenu = appearanceMenu
        viewMenu.addItem(appearanceItem)
        viewMenu.addItem(.separator())
        let sidebar = addItem("显示或隐藏侧边栏", to: viewMenu, action: #selector(toggleSidebar(_:)), key: "s", target: self)
        sidebar.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(.separator())
        addItem("进入全屏幕", to: viewMenu, action: #selector(NSWindow.toggleFullScreen(_:)), key: "f", target: nil).keyEquivalentModifierMask = [.command, .control]

        let windowMenu = addTopLevelMenu("窗口", to: mainMenu)
        addItem("最小化", to: windowMenu, action: #selector(NSWindow.performMiniaturize(_:)), key: "m", target: nil)
        addItem("缩放", to: windowMenu, action: #selector(NSWindow.performZoom(_:)), key: "", target: nil)
        windowMenu.addItem(.separator())
        addItem("前置全部窗口", to: windowMenu, action: #selector(NSApplication.arrangeInFront(_:)), key: "", target: nil)
        NSApp.windowsMenu = windowMenu

        let helpMenu = addTopLevelMenu("帮助", to: mainMenu)
        addItem("鹅的笔记帮助", to: helpMenu, action: #selector(openHelp(_:)), key: "?", target: self)
        NSApp.helpMenu = helpMenu
        updateAppearanceMenuState()
    }

    @discardableResult
    private func addTopLevelMenu(_ title: String, to mainMenu: NSMenu) -> NSMenu {
        let item = NSMenuItem()
        mainMenu.addItem(item)
        let menu = NSMenu(title: title)
        item.submenu = menu
        return menu
    }

    @discardableResult
    private func addItem(_ title: String, to menu: NSMenu, action: Selector?, key: String, target: AnyObject?) -> NSMenuItem {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.target = target
        return item
    }

    private func addFormatItem(
        _ title: String,
        command: String,
        key: String,
        modifiers: NSEvent.ModifierFlags = [.command],
        to menu: NSMenu
    ) {
        let item = addItem(title, to: menu, action: #selector(formatEditor(_:)), key: key, target: self)
        item.keyEquivalentModifierMask = modifiers
        item.representedObject = command
    }

    private func updateAppearanceMenuState() {
        guard let viewMenu = NSApp.mainMenu?.item(withTitle: "显示")?.submenu,
              let appearanceMenu = viewMenu.item(withTitle: "外观")?.submenu else { return }
        for item in appearanceMenu.items {
            item.state = (item.representedObject as? String) == preferences.appearanceMode.rawValue ? .on : .off
        }
    }
}
