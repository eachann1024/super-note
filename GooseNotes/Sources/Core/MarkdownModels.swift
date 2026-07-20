import Foundation
import UniformTypeIdentifiers

enum MarkdownFileType {
    static let identifier = "net.daringfireball.markdown"
    static let extensions: Set<String> = ["md", "markdown"]
    static let contentType = UTType(importedAs: identifier, conformingTo: .plainText)

    static func supports(_ url: URL) -> Bool {
        url.isFileURL && extensions.contains(url.pathExtension.localizedLowercase)
    }
}

struct MarkdownDocument: Equatable, Identifiable, Sendable {
    let id: String
    var fileURL: URL
    var title: String
    var markdown: String
    var revision: Int
    var modificationDate: Date?

    var displayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fileURL.deletingPathExtension().lastPathComponent : trimmed
    }
}

struct MarkdownWorkspace: Equatable, Sendable {
    var folderURL: URL
    var files: [MarkdownWorkspaceFile]

    var displayName: String {
        let name = folderURL.lastPathComponent
        return name.isEmpty ? folderURL.path : name
    }
}

struct MarkdownWorkspaceFile: Equatable, Identifiable, Sendable {
    var fileURL: URL
    var relativePath: String

    var id: String { fileURL.standardizedFileURL.path }
    var displayName: String { fileURL.deletingPathExtension().lastPathComponent }

    var parentPath: String? {
        let parent = (relativePath as NSString).deletingLastPathComponent
        return parent == "." || parent.isEmpty ? nil : parent
    }
}

enum SaveState: Equatable, Sendable {
    case idle
    case saving
    case saved(Date)
    case failed(String)
}

struct EditorDraft: Codable, Sendable {
    var version: Int
    var requestID: String
    var pageID: String
    var baseRevision: Int
    var title: String
    var markdown: String
    var hasChanges: Bool
}

struct SaveAcknowledgement: Codable, Sendable {
    enum Status: String, Codable, Sendable {
        case saved
        case conflict
        case failed
    }

    var version: Int = 1
    var requestID: String
    var pageID: String
    var revision: Int
    var status: Status
    var message: String?
}
