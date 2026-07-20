import AppKit

enum AppearanceMode: String, CaseIterable {
    case system
    case light
    case dark

    var title: String {
        switch self {
        case .system: "跟随系统"
        case .light: "浅色"
        case .dark: "深色"
        }
    }

    var appearance: NSAppearance? {
        switch self {
        case .system: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }
}

enum EditorFontMode: String, CaseIterable {
    case sans
    case serif
    case mono

    var title: String {
        switch self {
        case .sans: "系统无衬线"
        case .serif: "衬线"
        case .mono: "等宽"
        }
    }
}

@MainActor
final class AppPreferences {
    static let shared = AppPreferences()

    private enum Key {
        static let appearance = "GooseNotes.appearance"
        static let editorFont = "GooseNotes.editorFont"
        static let editorFullWidth = "GooseNotes.editorFullWidth"
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var appearanceMode: AppearanceMode {
        get { AppearanceMode(rawValue: defaults.string(forKey: Key.appearance) ?? "") ?? .system }
        set {
            if newValue == .system { defaults.removeObject(forKey: Key.appearance) }
            else { defaults.set(newValue.rawValue, forKey: Key.appearance) }
            NotificationCenter.default.post(name: .preferencesDidChange, object: self)
        }
    }

    var editorFontMode: EditorFontMode {
        get { EditorFontMode(rawValue: defaults.string(forKey: Key.editorFont) ?? "") ?? .sans }
        set {
            defaults.set(newValue.rawValue, forKey: Key.editorFont)
            NotificationCenter.default.post(name: .preferencesDidChange, object: self)
        }
    }

    var editorFullWidth: Bool {
        get { defaults.bool(forKey: Key.editorFullWidth) }
        set {
            defaults.set(newValue, forKey: Key.editorFullWidth)
            NotificationCenter.default.post(name: .preferencesDidChange, object: self)
        }
    }
}

extension Notification.Name {
    static let preferencesDidChange = Notification.Name("GooseNotes.preferencesDidChange")
}
