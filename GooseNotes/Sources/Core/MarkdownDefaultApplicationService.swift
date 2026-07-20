import AppKit

@MainActor
final class MarkdownDefaultApplicationService {
    private let workspace: NSWorkspace
    private let applicationURL: URL

    init(
        workspace: NSWorkspace = .shared,
        applicationURL: URL = Bundle.main.bundleURL
    ) {
        self.workspace = workspace
        self.applicationURL = applicationURL
    }

    var isCurrentApplicationDefault: Bool {
        guard let defaultURL = workspace.urlForApplication(toOpen: MarkdownFileType.contentType) else {
            return false
        }
        return normalized(defaultURL) == normalized(applicationURL)
    }

    func setCurrentApplicationAsDefault() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            workspace.setDefaultApplication(
                at: applicationURL,
                toOpen: MarkdownFileType.contentType
            ) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    private func normalized(_ url: URL) -> URL {
        url.standardizedFileURL.resolvingSymlinksInPath()
    }
}
