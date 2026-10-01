import SwiftUI
import WebKit

struct PartyWebScreen: View {
    @EnvironmentObject private var appState: AppState
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var canGoBack = false
    @State private var reloadToken = 0
    let url: URL

    var body: some View {
        ZStack(alignment: .topLeading) {
            PartyWebView(
                url: url,
                allowedOrigin: origin(of: url),
                loading: $loading,
                errorMessage: $errorMessage,
                canGoBack: $canGoBack,
                reloadToken: reloadToken
            )

            webChrome(title: "PARTY CONTROLLER", close: appState.leaveController)

            if loading {
                loadingOverlay("CONNECTING TO PARTY…")
            }

            if let errorMessage {
                errorOverlay(errorMessage)
            }
        }
        .ignoresSafeArea(.keyboard)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    private func errorOverlay(_ detail: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(.yellow)
            Text("CONNECTION INTERRUPTED")
                .font(.headline.bold())
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("RETRY") {
                errorMessage = nil
                loading = true
                reloadToken += 1
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(24)
        .frame(maxWidth: 320)
        .background(.black.opacity(0.92), in: RoundedRectangle(cornerRadius: 18))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private func webChrome(title: String, close: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Button(action: close) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.7))
            }
            .accessibilityLabel("Close CPI Party controller")

            Text(title)
                .font(.caption.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.black.opacity(0.7), in: Capsule())
        }
        .padding(.top, 8)
        .padding(.leading, 8)
    }

    private func loadingOverlay(_ text: String) -> some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(.yellow)
            Text(text)
                .font(.caption.bold())
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .background(.black.opacity(0.82), in: RoundedRectangle(cornerRadius: 16))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func origin(of url: URL) -> String {
        Self.origin(of: url)
    }

    static func origin(of url: URL) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = ""
        components?.query = nil
        components?.fragment = nil
        return components?.string?.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
    }
}

struct PortalWebScreen: View {
    @EnvironmentObject private var appState: AppState
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var canGoBack = false
    @State private var goBackToken = 0
    @State private var reloadToken = 0
    let url: URL
    let title: String

    var body: some View {
        ZStack(alignment: .topLeading) {
            PartyWebView(
                url: url,
                allowedOrigin: PartyWebScreen.origin(of: url),
                loading: $loading,
                errorMessage: $errorMessage,
                canGoBack: $canGoBack,
                goBackToken: goBackToken,
                reloadToken: reloadToken
            )

            HStack(spacing: 10) {
                Button {
                    if canGoBack {
                        goBackToken += 1
                    } else {
                        appState.closePortal()
                    }
                } label: {
                    Image(systemName: canGoBack ? "chevron.left.circle.fill" : "xmark.circle.fill")
                        .font(.title2)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.7))
                }
                .accessibilityLabel(canGoBack ? "Back" : "Close \(title)")

                Text(title.uppercased())
                    .font(.caption.bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.black.opacity(0.7), in: Capsule())

                if canGoBack {
                    Button {
                        appState.closePortal()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.white.opacity(0.9))
                    }
                    .accessibilityLabel("Close \(title)")
                }
            }
            .padding(.top, 8)
            .padding(.leading, 8)

            if loading {
                VStack(spacing: 12) {
                    ProgressView().tint(.yellow)
                    Text("OPENING \(title.uppercased())…")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                }
                .padding(20)
                .background(.black.opacity(0.82), in: RoundedRectangle(cornerRadius: 16))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            if let errorMessage {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.largeTitle)
                        .foregroundStyle(.yellow)
                    Text("PAGE UNAVAILABLE")
                        .font(.headline.bold())
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    HStack {
                        Button("CLOSE") { appState.closePortal() }
                            .buttonStyle(.bordered)
                        Button("RETRY") {
                            errorMessage = nil
                            loading = true
                            reloadToken += 1
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
                .padding(24)
                .frame(maxWidth: 320)
                .background(.black.opacity(0.92), in: RoundedRectangle(cornerRadius: 18))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            }
        }
        .ignoresSafeArea(.keyboard)
    }
}

struct PartyWebView: UIViewRepresentable {
    let url: URL
    let allowedOrigin: String
    @Binding var loading: Bool
    @Binding var errorMessage: String?
    @Binding var canGoBack: Bool
    var goBackToken = 0
    var reloadToken = 0

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = true
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self

        if context.coordinator.lastGoBackToken != goBackToken {
            context.coordinator.lastGoBackToken = goBackToken
            if webView.canGoBack { webView.goBack() }
        }

        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            webView.reload()
        }

        if webView.url == nil {
            webView.load(URLRequest(url: url))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: PartyWebView
        var lastGoBackToken = 0
        var lastReloadToken = 0

        init(parent: PartyWebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.loading = true
            parent.errorMessage = nil
            parent.canGoBack = webView.canGoBack
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.loading = false
            parent.errorMessage = nil
            parent.canGoBack = webView.canGoBack
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            fail(webView, error: error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            fail(webView, error: error)
        }

        private func fail(_ webView: WKWebView, error: Error) {
            parent.loading = false
            parent.canGoBack = webView.canGoBack
            let nsError = error as NSError
            if nsError.code == NSURLErrorCancelled { return }
            parent.errorMessage = error.localizedDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let target = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if PartyWebScreen.origin(of: target) == parent.allowedOrigin {
                decisionHandler(.allow)
                return
            }

            if navigationAction.navigationType == .linkActivated,
               let scheme = target.scheme?.lowercased(),
               scheme == "https" || scheme == "http" {
                UIApplication.shared.open(target)
            }
            decisionHandler(.cancel)
        }
    }
}
