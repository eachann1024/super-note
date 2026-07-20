import Foundation

enum TestFixtures {
    static func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("GooseNotesTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static func markdownURL(in directory: URL, name: String = "测试.md") -> URL {
        directory.appendingPathComponent(name)
    }

    static func draft(
        pageID: String,
        baseRevision: Int,
        title: String,
        markdown: String,
        hasChanges: Bool = true
    ) -> EditorDraft {
        EditorDraft(
            version: 1,
            requestID: UUID().uuidString,
            pageID: pageID,
            baseRevision: baseRevision,
            title: title,
            markdown: markdown,
            hasChanges: hasChanges
        )
    }
}
