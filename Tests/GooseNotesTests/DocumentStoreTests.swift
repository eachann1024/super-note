import XCTest

@MainActor
final class DocumentStoreTests: XCTestCase {
    func testOpeningFolderListsMarkdownAndSelectsFirstFile() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try "第二篇".write(to: directory.appendingPathComponent("02-第二篇.md"), atomically: true, encoding: .utf8)
        try "第一篇".write(to: directory.appendingPathComponent("01-第一篇.md"), atomically: true, encoding: .utf8)
        try "忽略".write(to: directory.appendingPathComponent("说明.txt"), atomically: true, encoding: .utf8)
        let store = DocumentStore()

        let selected = try await store.openFolder(url: directory)

        XCTAssertEqual(store.workspace?.displayName, directory.lastPathComponent)
        XCTAssertEqual(store.workspace?.files.map(\.relativePath), ["01-第一篇.md", "02-第二篇.md"])
        XCTAssertEqual(selected?.fileURL.lastPathComponent, "01-第一篇.md")
        XCTAssertEqual(store.activeDocument?.markdown, "第一篇")
    }

    func testRenamingWorkspaceDocumentRefreshesSidebarFileList() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("旧名称.md")
        try "内容".write(to: url, atomically: true, encoding: .utf8)
        let store = DocumentStore()
        let opened = try await store.openFolder(url: directory)
        let document = try XCTUnwrap(opened)

        let acknowledgement = await store.applyEditorDraft(
            TestFixtures.draft(
                pageID: document.id,
                baseRevision: document.revision,
                title: "新名称",
                markdown: "新内容"
            )
        )

        XCTAssertEqual(acknowledgement.status, .saved)
        XCTAssertEqual(store.workspace?.files.map(\.relativePath), ["新名称.md"])
        XCTAssertEqual(store.activeDocument?.fileURL.lastPathComponent, "新名称.md")
    }

    func testEditorDraftWritesMarkdownDirectlyToDiskAndRenamesFile() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = TestFixtures.markdownURL(in: directory)
        let store = DocumentStore()
        let document = try await store.create(at: url)

        let acknowledgement = await store.applyEditorDraft(
            TestFixtures.draft(
                pageID: document.id,
                baseRevision: 0,
                title: "每日记录",
                markdown: "## 今天\n\n只存本地 Markdown。"
            )
        )

        XCTAssertEqual(acknowledgement.status, .saved)
        XCTAssertEqual(acknowledgement.revision, 1)
        XCTAssertEqual(store.activeDocument?.fileURL.lastPathComponent, "每日记录.md")
        XCTAssertEqual(
            try String(contentsOf: directory.appendingPathComponent("每日记录.md"), encoding: .utf8),
            "## 今天\n\n只存本地 Markdown。"
        )
    }

    func testStaleRevisionIsRejectedWithoutWritingFile() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = TestFixtures.markdownURL(in: directory)
        let store = DocumentStore()
        let document = try await store.create(at: url)

        let first = await store.applyEditorDraft(
            TestFixtures.draft(pageID: document.id, baseRevision: 0, title: "测试", markdown: "第一版")
        )
        XCTAssertEqual(first.status, .saved)

        let stale = await store.applyEditorDraft(
            TestFixtures.draft(pageID: document.id, baseRevision: 0, title: "测试", markdown: "过期内容")
        )
        XCTAssertEqual(stale.status, .conflict)
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "第一版")
    }

    func testInactiveDocumentDraftIsRejected() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let firstURL = TestFixtures.markdownURL(in: directory, name: "一.md")
        let secondURL = TestFixtures.markdownURL(in: directory, name: "二.md")
        let store = DocumentStore()
        let first = try await store.create(at: firstURL)
        _ = try await store.create(at: secondURL)

        let acknowledgement = await store.applyEditorDraft(
            TestFixtures.draft(pageID: first.id, baseRevision: 0, title: "一", markdown: "不应写入")
        )

        XCTAssertEqual(acknowledgement.status, .conflict)
        XCTAssertEqual(try String(contentsOf: firstURL, encoding: .utf8), "")
    }

    func testUnchangedDraftDoesNotIncrementRevision() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = TestFixtures.markdownURL(in: directory)
        let store = DocumentStore()
        let document = try await store.create(at: url)

        let acknowledgement = await store.applyEditorDraft(
            TestFixtures.draft(pageID: document.id, baseRevision: 0, title: "测试", markdown: "")
        )

        XCTAssertEqual(acknowledgement.status, .saved)
        XCTAssertEqual(acknowledgement.revision, 0)
        XCTAssertEqual(store.activeDocument?.revision, 0)
    }

    func testUntouchedDraftNeverRewritesLossyMarkdown() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = TestFixtures.markdownURL(in: directory)
        let original = "---\ntitle: 原样保留\n---\n\n<div data-note=\"raw\">HTML</div>\n"
        try original.write(to: url, atomically: true, encoding: .utf8)
        let store = DocumentStore()
        let document = try await store.open(url: url)

        let acknowledgement = await store.applyEditorDraft(
            TestFixtures.draft(
                pageID: document.id,
                baseRevision: 0,
                title: document.title,
                markdown: "title: 原样保留\n\nHTML",
                hasChanges: false
            )
        )

        XCTAssertEqual(acknowledgement.status, .saved)
        XCTAssertEqual(acknowledgement.revision, 0)
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), original)
    }

    func testClosingDocumentForgetsSessionWithoutDeletingFile() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = TestFixtures.markdownURL(in: directory)
        let store = DocumentStore()
        let document = try await store.create(at: url)

        store.closeDocument(id: document.id)

        XCTAssertTrue(store.documents.isEmpty)
        XCTAssertNil(store.activeDocumentID)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }
}
