import AppKit
import Foundation

extension Notification.Name {
    static let documentsDidChange = Notification.Name("GooseNotes.documentsDidChange")
    static let saveStateDidChange = Notification.Name("GooseNotes.saveStateDidChange")
}

@MainActor
final class DocumentStore {
    private(set) var documents: [MarkdownDocument] = []
    private(set) var workspace: MarkdownWorkspace?
    private(set) var activeDocumentID: String?
    private(set) var saveState: SaveState = .idle {
        didSet {
            guard oldValue != saveState else { return }
            NotificationCenter.default.post(name: .saveStateDidChange, object: self)
        }
    }

    private let repository: MarkdownFileRepository
    private var securityScopedURLs: [String: URL] = [:]
    private var securityScopedWorkspaceURL: URL?

    init(repository: MarkdownFileRepository = MarkdownFileRepository()) {
        self.repository = repository
    }

    var activeDocument: MarkdownDocument? {
        activeDocumentID.flatMap(document(id:))
    }

    func document(id: String) -> MarkdownDocument? {
        documents.first { $0.id == id }
    }

    func filteredDocuments(query: String = "") -> [MarkdownDocument] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).localizedLowercase
        guard !needle.isEmpty else { return documents }
        return documents.filter {
            $0.displayTitle.localizedLowercase.contains(needle)
                || $0.markdown.localizedLowercase.contains(needle)
        }
    }

    func filteredWorkspaceFiles(query: String = "") -> [MarkdownWorkspaceFile] {
        guard let workspace else { return [] }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).localizedLowercase
        guard !needle.isEmpty else { return workspace.files }
        return workspace.files.filter {
            $0.relativePath.localizedLowercase.contains(needle)
        }
    }

    func document(for url: URL) -> MarkdownDocument? {
        let target = url.standardizedFileURL
        return documents.first { $0.fileURL.standardizedFileURL == target }
    }

    func containsInWorkspace(_ url: URL) -> Bool {
        guard let folderURL = workspace?.folderURL.standardizedFileURL else { return false }
        let prefix = folderURL.path.hasSuffix("/") ? folderURL.path : folderURL.path + "/"
        return url.standardizedFileURL.path.hasPrefix(prefix)
    }

    @discardableResult
    func create(at url: URL) async throws -> MarkdownDocument {
        _ = try await repository.create(at: url)
        let document = try await open(url: url)
        if let folderURL = workspace?.folderURL, containsInWorkspace(document.fileURL) {
            let files = try await repository.listMarkdownFiles(in: folderURL)
            workspace = MarkdownWorkspace(folderURL: folderURL, files: files)
            notifyDocumentsChanged()
        }
        return document
    }

    @discardableResult
    func open(url sourceURL: URL) async throws -> MarkdownDocument {
        let url = sourceURL.standardizedFileURL
        if let existing = documents.first(where: { $0.fileURL.standardizedFileURL == url }) {
            activeDocumentID = existing.id
            notifyDocumentsChanged()
            return existing
        }

        let usesWorkspaceScope = containsInWorkspace(url)
        let accessed = usesWorkspaceScope ? false : url.startAccessingSecurityScopedResource()
        do {
            let snapshot = try await repository.read(from: url)
            let document = MarkdownDocument(
                id: UUID().uuidString.lowercased(),
                fileURL: url,
                title: url.deletingPathExtension().lastPathComponent,
                markdown: snapshot.markdown,
                revision: 0,
                modificationDate: snapshot.modificationDate
            )
            documents.append(document)
            activeDocumentID = document.id
            if accessed { securityScopedURLs[document.id] = url }
            NSDocumentController.shared.noteNewRecentDocumentURL(url)
            notifyDocumentsChanged()
            return document
        } catch {
            if accessed { url.stopAccessingSecurityScopedResource() }
            throw error
        }
    }

    @discardableResult
    func openFolder(url sourceURL: URL) async throws -> MarkdownDocument? {
        let folderURL = sourceURL.standardizedFileURL
        let accessed = folderURL.startAccessingSecurityScopedResource()
        do {
            let files = try await repository.listMarkdownFiles(in: folderURL)
            closeAllDocuments()
            if let oldWorkspaceURL = securityScopedWorkspaceURL {
                oldWorkspaceURL.stopAccessingSecurityScopedResource()
            }
            securityScopedWorkspaceURL = accessed ? folderURL : nil
            workspace = MarkdownWorkspace(folderURL: folderURL, files: files)
            notifyDocumentsChanged()
            guard let firstFile = files.first else { return nil }
            return try await open(url: firstFile.fileURL)
        } catch {
            if accessed { folderURL.stopAccessingSecurityScopedResource() }
            throw error
        }
    }

    func refreshWorkspace() async throws {
        guard let folderURL = workspace?.folderURL else { return }
        let files = try await repository.listMarkdownFiles(in: folderURL)
        workspace = MarkdownWorkspace(folderURL: folderURL, files: files)
        notifyDocumentsChanged()
    }

    func selectDocument(id: String) {
        guard document(id: id) != nil else { return }
        activeDocumentID = id
        notifyDocumentsChanged()
    }

    func closeDocument(id: String) {
        guard let index = documents.firstIndex(where: { $0.id == id }) else { return }
        documents.remove(at: index)
        if let securityURL = securityScopedURLs.removeValue(forKey: id) {
            securityURL.stopAccessingSecurityScopedResource()
        }
        if activeDocumentID == id {
            activeDocumentID = documents.indices.contains(index) ? documents[index].id : documents.last?.id
        }
        saveState = .idle
        notifyDocumentsChanged()
    }

    func closeAllDocuments() {
        for url in securityScopedURLs.values {
            url.stopAccessingSecurityScopedResource()
        }
        securityScopedURLs.removeAll()
        documents.removeAll()
        activeDocumentID = nil
        saveState = .idle
        notifyDocumentsChanged()
    }

    func markEditorDirty(pageID: String) {
        guard activeDocumentID == pageID else { return }
        saveState = .saving
    }

    func applyEditorDraft(_ draft: EditorDraft) async -> SaveAcknowledgement {
        guard draft.version == 1,
              let index = documents.firstIndex(where: { $0.id == draft.pageID }) else {
            return acknowledgement(for: draft, revision: draft.baseRevision, status: .failed,
                                   message: "文件未打开或桥接版本不受支持。")
        }
        guard activeDocumentID == draft.pageID else {
            return acknowledgement(for: draft, revision: documents[index].revision, status: .conflict,
                                   message: "当前文件已切换，请重新载入后继续编辑。")
        }
        guard documents[index].revision == draft.baseRevision else {
            return acknowledgement(for: draft, revision: documents[index].revision, status: .conflict,
                                   message: "文件版本已变化，请重新载入。")
        }

        guard draft.hasChanges else {
            if case .saving = saveState { saveState = .saved(Date()) }
            return acknowledgement(for: draft, revision: documents[index].revision, status: .saved)
        }

        let normalizedTitle = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let changed = documents[index].title != normalizedTitle || documents[index].markdown != draft.markdown
        guard changed else {
            if case .saving = saveState { saveState = .saved(Date()) }
            return acknowledgement(for: draft, revision: documents[index].revision, status: .saved)
        }

        saveState = .saving
        do {
            let result = try await repository.save(
                markdown: draft.markdown,
                at: documents[index].fileURL,
                title: normalizedTitle,
                expectedModificationDate: documents[index].modificationDate
            )
            documents[index].fileURL = result.fileURL
            documents[index].title = normalizedTitle
            documents[index].markdown = draft.markdown
            documents[index].revision += 1
            documents[index].modificationDate = result.modificationDate
            let revision = documents[index].revision
            saveState = .saved(Date())
            NSDocumentController.shared.noteNewRecentDocumentURL(result.fileURL)
            if let folderURL = workspace?.folderURL, containsInWorkspace(result.fileURL) {
                let files = try await repository.listMarkdownFiles(in: folderURL)
                workspace = MarkdownWorkspace(folderURL: folderURL, files: files)
            }
            notifyDocumentsChanged()
            return acknowledgement(for: draft, revision: revision, status: .saved)
        } catch let error as MarkdownFileRepositoryError {
            saveState = .failed(error.localizedDescription)
            let status: SaveAcknowledgement.Status = error == .fileChanged ? .conflict : .failed
            return acknowledgement(for: draft, revision: documents[index].revision, status: status,
                                   message: error.localizedDescription)
        } catch {
            saveState = .failed(error.localizedDescription)
            return acknowledgement(for: draft, revision: documents[index].revision, status: .failed,
                                   message: error.localizedDescription)
        }
    }

    func reloadActiveDocument() async throws {
        guard let id = activeDocumentID,
              let index = documents.firstIndex(where: { $0.id == id }) else { return }
        let snapshot = try await repository.read(from: documents[index].fileURL)
        documents[index].markdown = snapshot.markdown
        documents[index].revision += 1
        documents[index].modificationDate = snapshot.modificationDate
        documents[index].title = documents[index].fileURL.deletingPathExtension().lastPathComponent
        saveState = .idle
        notifyDocumentsChanged()
    }

    func stopAccessingFiles() {
        for url in securityScopedURLs.values {
            url.stopAccessingSecurityScopedResource()
        }
        securityScopedURLs.removeAll()
        securityScopedWorkspaceURL?.stopAccessingSecurityScopedResource()
        securityScopedWorkspaceURL = nil
    }

    private func acknowledgement(
        for draft: EditorDraft,
        revision: Int,
        status: SaveAcknowledgement.Status,
        message: String? = nil
    ) -> SaveAcknowledgement {
        SaveAcknowledgement(
            requestID: draft.requestID,
            pageID: draft.pageID,
            revision: revision,
            status: status,
            message: message
        )
    }

    private func notifyDocumentsChanged() {
        NotificationCenter.default.post(name: .documentsDidChange, object: self)
    }
}
