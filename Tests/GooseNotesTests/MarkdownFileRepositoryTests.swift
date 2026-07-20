import XCTest

final class MarkdownFileRepositoryTests: XCTestCase {
    func testListsMarkdownFilesRecursivelyInStableOrder() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let nested = directory.appendingPathComponent("资料", isDirectory: true)
        let hidden = directory.appendingPathComponent(".隐藏", isDirectory: true)
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: hidden, withIntermediateDirectories: true)
        try "A".write(to: directory.appendingPathComponent("A.md"), atomically: true, encoding: .utf8)
        try "B".write(to: nested.appendingPathComponent("B.markdown"), atomically: true, encoding: .utf8)
        try "忽略".write(to: nested.appendingPathComponent("说明.txt"), atomically: true, encoding: .utf8)
        try "忽略".write(to: hidden.appendingPathComponent("秘密.md"), atomically: true, encoding: .utf8)

        let files = try await MarkdownFileRepository().listMarkdownFiles(in: directory)

        XCTAssertEqual(files.map(\.relativePath), ["A.md", "资料/B.markdown"])
    }

    func testCreateReadSaveAndRenameUseOnlyMarkdownFile() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let originalURL = TestFixtures.markdownURL(in: directory)
        let repository = MarkdownFileRepository()

        _ = try await repository.create(at: originalURL)
        let created = try await repository.read(from: originalURL)
        XCTAssertEqual(created.markdown, "")

        let saved = try await repository.save(
            markdown: "# 本地文件\n\n内容",
            at: originalURL,
            title: "重命名",
            expectedModificationDate: created.modificationDate
        )

        XCTAssertEqual(saved.fileURL.lastPathComponent, "重命名.md")
        XCTAssertFalse(FileManager.default.fileExists(atPath: originalURL.path))
        XCTAssertEqual(try String(contentsOf: saved.fileURL, encoding: .utf8), "# 本地文件\n\n内容")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), ["重命名.md"])
    }

    func testSaveRejectsFileChangedByAnotherApplication() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = TestFixtures.markdownURL(in: directory)
        let repository = MarkdownFileRepository()

        _ = try await repository.create(at: url)
        let opened = try await repository.read(from: url)
        try "外部修改".write(to: url, atomically: true, encoding: .utf8)
        let futureDate = (opened.modificationDate ?? Date()).addingTimeInterval(10)
        try FileManager.default.setAttributes([.modificationDate: futureDate], ofItemAtPath: url.path)

        do {
            _ = try await repository.save(
                markdown: "不应覆盖",
                at: url,
                title: "测试",
                expectedModificationDate: opened.modificationDate
            )
            XCTFail("外部修改后不应覆盖文件")
        } catch let error as MarkdownFileRepositoryError {
            XCTAssertEqual(error, .fileChanged)
            XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "外部修改")
        }
    }

    func testRepositoryRejectsNonMarkdownFile() async throws {
        let directory = try TestFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("note.txt")

        do {
            _ = try await MarkdownFileRepository().create(at: url)
            XCTFail("不应创建非 Markdown 文件")
        } catch let error as MarkdownFileRepositoryError {
            XCTAssertEqual(error, .unsupportedFileType)
        }
    }
}
