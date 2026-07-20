import AppKit

@MainActor
final class MainSplitViewController: NSSplitViewController {
    let sidebarController: SidebarViewController
    let editorController: EditorContainerViewController

    init(store: DocumentStore, preferences: AppPreferences = .shared) {
        sidebarController = SidebarViewController(store: store)
        editorController = EditorContainerViewController(store: store, preferences: preferences)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        splitView.dividerStyle = .thin
        splitView.autosaveName = "GooseNotes.MainSplit"

        let sidebarItem = NSSplitViewItem(sidebarWithViewController: sidebarController)
        sidebarItem.minimumThickness = 216
        sidebarItem.maximumThickness = 340
        sidebarItem.preferredThicknessFraction = 0.22
        sidebarItem.canCollapse = true
        sidebarItem.holdingPriority = .init(260)

        let editorItem = NSSplitViewItem(viewController: editorController)
        editorItem.minimumThickness = 520
        editorItem.holdingPriority = .init(250)
        addSplitViewItem(sidebarItem)
        addSplitViewItem(editorItem)
    }

    func toggleSidebar() {
        guard let item = splitViewItems.first else { return }
        item.animator().isCollapsed.toggle()
    }

    var isSidebarCollapsed: Bool { splitViewItems.first?.isCollapsed ?? false }
}
