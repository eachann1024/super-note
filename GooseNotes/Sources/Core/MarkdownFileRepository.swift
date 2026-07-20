import Foundation

enum MarkdownFileRepositoryError: LocalizedError, Equatable {
    case unsupportedFileType
    case invalidUTF8
    case invalidTitle
    case fileChanged
    case nameAlreadyExists(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedFileType:
            return "只支持 .md 和 .markdown 文件。"
        case .invalidUTF8:
            return "文件不是有效的 UTF-8 Markdown 文本。"
        case .invalidTitle:
            return "文件名不能为空，也不能包含斜杠。"
        case .fileChanged:
            return "文件已被其他应用修改，请重新载入后继续编辑。"
        case .nameAlreadyExists(let name):
            return "同一文件夹中已存在“\(name)”。"
        }
    }
}

struct MarkdownFileSnapshot: Sendable, Equatable {
    var markdown: String
    var modificationDate: Date?
}

struct MarkdownSaveResult: Sendable, Equatable {
    var fileURL: URL
    var modificationDate: Date?
}

actor MarkdownFileRepository {
    private let fileManager: FileManager

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    func create(at sourceURL: URL) throws -> MarkdownFileSnapshot {
        let url = sourceURL.standardizedFileURL
        try validateMarkdownURL(url)
        try Data().write(to: url, options: .atomic)
        return MarkdownFileSnapshot(markdown: "", modificationDate: modificationDate(for: url))
    }

    func read(from sourceURL: URL) throws -> MarkdownFileSnapshot {
        let url = sourceURL.standardizedFileURL
        try validateMarkdownURL(url)
        let data = try Data(contentsOf: url)
        guard let markdown = String(data: data, encoding: .utf8) else {
            throw MarkdownFileRepositoryError.invalidUTF8
        }
        return MarkdownFileSnapshot(markdown: markdown, modificationDate: modificationDate(for: url))
    }

    func listMarkdownFiles(in sourceURL: URL) throws -> [MarkdownWorkspaceFile] {
        let folderURL = sourceURL.standardizedFileURL
        let values = try folderURL.resourceValues(forKeys: [.isDirectoryKey])
        guard folderURL.isFileURL, values.isDirectory == true else {
            throw CocoaError(.fileReadNoSuchFile)
        }

        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey]
        guard let enumerator = fileManager.enumerator(
            at: folderURL,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles, .skipsPackageDescendants],
            errorHandler: { _, _ in true }
        ) else {
            return []
        }

        var files: [MarkdownWorkspaceFile] = []
        for case let candidate as URL in enumerator {
            let resourceValues = try candidate.resourceValues(forKeys: keys)
            guard resourceValues.isRegularFile == true,
                  resourceValues.isSymbolicLink != true,
                  MarkdownFileType.supports(candidate) else {
                continue
            }
            let url = candidate.standardizedFileURL
            let prefix = folderURL.path.hasSuffix("/") ? folderURL.path : folderURL.path + "/"
            guard url.path.hasPrefix(prefix) else { continue }
            files.append(MarkdownWorkspaceFile(
                fileURL: url,
                relativePath: String(url.path.dropFirst(prefix.count))
            ))
        }

        return files.sorted {
            $0.relativePath.compare(
                $1.relativePath,
                options: [.caseInsensitive, .numeric],
                locale: Locale(identifier: "en_US_POSIX")
            ) == .orderedAscending
        }
    }

    func save(
        markdown: String,
        at sourceURL: URL,
        title: String,
        expectedModificationDate: Date?
    ) throws -> MarkdownSaveResult {
        let currentURL = sourceURL.standardizedFileURL
        try validateMarkdownURL(currentURL)
        if let expectedModificationDate,
           let currentModificationDate = modificationDate(for: currentURL),
           abs(currentModificationDate.timeIntervalSince(expectedModificationDate)) > 0.001 {
            throw MarkdownFileRepositoryError.fileChanged
        }

        let safeTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !safeTitle.isEmpty,
              safeTitle != ".",
              safeTitle != "..",
              !safeTitle.contains("/") else {
            throw MarkdownFileRepositoryError.invalidTitle
        }

        let fileExtension = currentURL.pathExtension.isEmpty ? "md" : currentURL.pathExtension
        let targetURL = currentURL
            .deletingLastPathComponent()
            .appendingPathComponent(safeTitle)
            .appendingPathExtension(fileExtension)
            .standardizedFileURL

        if targetURL != currentURL && fileManager.fileExists(atPath: targetURL.path) {
            throw MarkdownFileRepositoryError.nameAlreadyExists(targetURL.lastPathComponent)
        }

        if targetURL != currentURL {
            try fileManager.moveItem(at: currentURL, to: targetURL)
        }

        do {
            try coordinatedWrite(markdown, to: targetURL)
        } catch {
            if targetURL != currentURL, !fileManager.fileExists(atPath: currentURL.path) {
                try? fileManager.moveItem(at: targetURL, to: currentURL)
            }
            throw error
        }

        return MarkdownSaveResult(fileURL: targetURL, modificationDate: modificationDate(for: targetURL))
    }

    private func validateMarkdownURL(_ url: URL) throws {
        guard MarkdownFileType.supports(url) else {
            throw MarkdownFileRepositoryError.unsupportedFileType
        }
    }

    private func coordinatedWrite(_ markdown: String, to url: URL) throws {
        let data = Data(markdown.utf8)
        var coordinationError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(
            writingItemAt: url,
            options: .forReplacing,
            error: &coordinationError
        ) { coordinatedURL in
            do {
                try data.write(to: coordinatedURL, options: .atomic)
            } catch {
                writeError = error
            }
        }
        if let coordinationError { throw coordinationError }
        if let writeError { throw writeError }
    }

    private func modificationDate(for url: URL) -> Date? {
        try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
    }
}
