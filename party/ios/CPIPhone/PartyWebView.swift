import SwiftUI
import WebKit

struct PartyWebScreen: View {
    @EnvironmentObject private var appState: AppState
    let url: URL

    var body: some View {
        ZStack(alignment: .topLeading) {
            PartyWebView(url: url, allowedOrigin: origin(of: url))

            Button {
                appState.leaveController()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.65))
            }
            .padding(.top, 8)
            .padding(.leading, 8)
            .accessibilityLabel("Close CPI Party controller")
        }
        .ignoresSafeArea(.keyboard)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    private func origin(of url: URL) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = ""
        components?.query = nil
        components?.fragment = nil
        return components?.string?.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
    }
}

struct PartyWebView: UIViewRepresentable {
    let url: URL
    let allowedOrigin: String

    func makeCoordinator() -> Coordinator {
        Coordinator(allowedOrigin: allowedOrigin)
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
        webView.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.allowedOrigin = allowedOrigin
        if webView.url == nil {
            webView.load(URLRequest(url: url))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var allowedOrigin: String

        init(allowedOrigin: String) {
            self.allowedOrigin = allowedOrigin
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
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

            if Self.origin(of: target) == allowedOrigin {
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

        private static func origin(of url: URL) -> String {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.path = ""
            components?.query = nil
            components?.fragment = nil
            return components?.string?.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        }
    }
}
