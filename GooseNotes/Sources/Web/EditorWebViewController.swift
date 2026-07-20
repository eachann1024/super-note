import AppKit
import WebKit

private enum BridgeProtocol {
    static let version = 1
    static let handlerName = "gooseNotes"
}

private struct EditorPagePayload: Encodable {
    var version = BridgeProtocol.version
    var generation: Int
    var pageID: String
    var revision: Int
    var title: String
    var markdown: String
    var appearance: String
    var editorFont: String
    var fullWidth: Bool
    var reduceMotion: Bool
    var increaseContrast: Bool
}

private final class AppearanceAwareWebView: WKWebView {
    var onEffectiveAppearanceChange: (() -> Void)?

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        onEffectiveAppearanceChange?()
    }
}

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

@MainActor
final class EditorWebViewController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate {
    var onReady: (() -> Void)?
    var onLoadFailure: ((String) -> Void)?

    private(set) var currentPageID: String?
    private(set) var currentRevision: Int = 0
    private(set) var webView: WKWebView!
    private let store: DocumentStore
    private let preferences: AppPreferences
    private var isReady = false
    private var generation = 0
    private var pendingPage: MarkdownDocument?

    init(store: DocumentStore, preferences: AppPreferences = .shared) {
        self.store = store
        self.preferences = preferences
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.isElementFullscreenEnabled = false
        configuration.userContentController.add(
            WeakScriptMessageHandler(delegate: self),
            name: BridgeProtocol.handlerName
        )

        let appearanceAwareWebView = AppearanceAwareWebView(frame: .zero, configuration: configuration)
        appearanceAwareWebView.onEffectiveAppearanceChange = { [weak self] in self?.sendPreferences() }
        webView = appearanceAwareWebView
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsMagnification = false
        webView.setAccessibilityLabel("笔记编辑器")
        view = webView
        loadEditor()
    }

    func present(page: MarkdownDocument, force: Bool = false) {
        guard force || page.id != currentPageID || page.revision > currentRevision else { return }
        currentPageID = page.id
        currentRevision = page.revision
        pendingPage = page
        guard isReady else { return }
        send(page: page)
    }

    func clear() {
        currentPageID = nil
        currentRevision = 0
        pendingPage = nil
        evaluate(function: "clear", argument: ["version": BridgeProtocol.version])
    }

    func flush(completion: @escaping (Bool) -> Void) {
        guard isReady, currentPageID != nil else {
            completion(true)
            return
        }
        Task { @MainActor [weak self] in
            guard let self else { completion(false); return }
            do {
                let value = try await webView.callAsyncJavaScript(
                    "return await window.gooseEditor.flushAndGetDraft();",
                    arguments: [:],
                    in: nil,
                    contentWorld: .page
                )
                guard let value, let draft = decode(EditorDraft.self, from: value) else {
                    completion(false)
                    return
                }
                let acknowledgement = await store.applyEditorDraft(draft)
                receive(acknowledgement)
                completion(acknowledgement.status == .saved)
            } catch {
                onLoadFailure?("无法提交当前编辑：\(error.localizedDescription)")
                completion(false)
            }
        }
    }

    func dispatch(command: String) {
        evaluate(function: "dispatchCommand", argument: ["name": command])
    }

    func focusEditor() {
        guard isReady, currentPageID != nil else { return }
        webView.window?.makeFirstResponder(webView)
        evaluate(function: "focusEditor", argument: [:])
    }

    func sendPreferences() {
        guard isReady else { return }
        evaluate(function: "updatePreferences", argument: preferenceDictionary())
    }

    func printEditor() {
        let operation = webView.printOperation(with: NSPrintInfo.shared)
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == BridgeProtocol.handlerName,
              let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              (body["version"] as? Int) == BridgeProtocol.version else { return }

        switch type {
        case "ready":
            handleEditorReady()
        case "change":
            guard let draft = decode(EditorDraft.self, from: body) else { return }
            Task { [weak self] in
                guard let self else { return }
                let acknowledgement = await store.applyEditorDraft(draft)
                receive(acknowledgement)
            }
        case "dirty":
            guard let pageID = body["pageID"] as? String,
                  pageID == currentPageID else { return }
            store.markEditorDirty(pageID: pageID)
        case "reloadRequest":
            guard let pageID = body["pageID"] as? String,
                  pageID == currentPageID,
                  store.document(id: pageID) != nil else { return }
            Task { [weak self] in
                guard let self else { return }
                do {
                    try await store.reloadActiveDocument()
                    if let page = store.document(id: pageID) { present(page: page, force: true) }
                } catch {
                    onLoadFailure?("无法重新载入文件：\(error.localizedDescription)")
                }
            }
        default:
            break
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.navigationType == .linkActivated {
            guard ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else {
                decisionHandler(.cancel)
                return
            }
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        let allowedSchemes = ["file", "about", "blob", "data"]
        decisionHandler(allowedSchemes.contains(url.scheme?.lowercased() ?? "") ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        onLoadFailure?("编辑器加载失败：\(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        onLoadFailure?("编辑器加载失败：\(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isReady = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            for delay in [100, 250, 500] {
                try? await Task.sleep(for: .milliseconds(delay))
                guard !isReady else { return }
                do {
                    let value = try await webView.callAsyncJavaScript(
                        "return Boolean(window.gooseEditor && window.gooseEditor.receivePage);",
                        arguments: [:],
                        in: nil,
                        contentWorld: .page
                    )
                    if value as? Bool == true {
                        handleEditorReady()
                        return
                    }
                } catch {
                    continue
                }
            }
            guard !isReady else { return }
            onLoadFailure?("编辑器脚本未能完成初始化，请重新打开应用。")
        }
    }

    private func loadEditor() {
        guard let editorURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            onLoadFailure?("应用缺少编辑器资源，请重新安装。")
            return
        }
        webView.loadFileURL(editorURL, allowingReadAccessTo: editorURL.deletingLastPathComponent())
    }

    private func send(page: MarkdownDocument) {
        generation += 1
        let payload = EditorPagePayload(
            generation: generation,
            pageID: page.id,
            revision: page.revision,
            title: page.title,
            markdown: page.markdown,
            appearance: resolvedAppearance(),
            editorFont: preferences.editorFontMode.rawValue,
            fullWidth: preferences.editorFullWidth,
            reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
            increaseContrast: NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
        )
        guard let argument = jsonObject(from: payload) else {
            onLoadFailure?("无法编码当前 Markdown 页面。")
            return
        }
        let sentGeneration = generation
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                _ = try await webView.callAsyncJavaScript(
                    "if (!window.gooseEditor || !window.gooseEditor.receivePage) { throw new Error('editor bridge unavailable'); } await window.gooseEditor.receivePage(page); return true;",
                    arguments: ["page": argument],
                    in: nil,
                    contentWorld: .page
                )
                guard sentGeneration == generation, currentPageID == page.id else { return }
                pendingPage = nil
                focusEditor()
            } catch {
                guard sentGeneration == generation else { return }
                onLoadFailure?("无法显示 \(page.fileURL.lastPathComponent)：\(error.localizedDescription)")
            }
        }
    }

    private func receive(_ acknowledgement: SaveAcknowledgement) {
        if acknowledgement.pageID == currentPageID {
            currentRevision = max(currentRevision, acknowledgement.revision)
        }
        evaluate(function: "receiveAcknowledgement", encodable: acknowledgement)
    }

    private func preferenceDictionary() -> [String: Any] {
        [
            "appearance": resolvedAppearance(),
            "editorFont": preferences.editorFontMode.rawValue,
            "fullWidth": preferences.editorFullWidth,
            "reduceMotion": NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
            "increaseContrast": NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast,
        ]
    }

    private func resolvedAppearance() -> String {
        let match = view.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])
        return match == .darkAqua ? "dark" : "light"
    }

    private func handleEditorReady() {
        guard !isReady else { return }
        isReady = true
        sendPreferences()
        if let pendingPage { send(page: pendingPage) }
        onReady?()
    }

    private func jsonObject<T: Encodable>(from value: T) -> Any? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private func evaluate<T: Encodable>(function: String, encodable: T) {
        guard let data = try? JSONEncoder().encode(encodable),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.gooseEditor?.\(function)(\(json));")
    }

    private func evaluate(function: String, argument: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(argument),
              let data = try? JSONSerialization.data(withJSONObject: argument),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.gooseEditor?.\(function)(\(json));")
    }

    private func decode<T: Decodable>(_ type: T.Type, from object: Any) -> T? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
