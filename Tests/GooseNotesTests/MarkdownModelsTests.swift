import XCTest

final class MarkdownModelsTests: XCTestCase {
    func testDisplayTitleUsesFilenameWhenTitleIsBlank() {
        let document = MarkdownDocument(
            id: "document",
            fileURL: URL(fileURLWithPath: "/tmp/本地笔记.md"),
            title: "  ",
            markdown: "",
            revision: 0,
            modificationDate: nil
        )

        XCTAssertEqual(document.displayTitle, "本地笔记")
    }
}
