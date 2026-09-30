import Foundation

@MainActor
final class AppState: ObservableObject {
    private enum Keys {
        static let serverURL = "cpi.iphone.serverURL"
    }

    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: Keys.serverURL) }
    }
    @Published var roomCode = ""
    @Published var activePartyURL: URL?
    @Published var message: String?

    init() {
        serverURL = UserDefaults.standard.string(forKey: Keys.serverURL) ?? ""
    }

    func join() {
        guard let base = normalizedServerURL(serverURL) else {
            message = "Enter the CPI Party server address."
            return
        }

        let code = normalizedCode(roomCode)
        guard code.count == 4 else {
            message = "Room codes are 4 letters."
            return
        }

        var components = URLComponents(url: base.appendingPathComponent("play"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "code", value: code)]
        guard let url = components?.url else {
            message = "That server address could not be opened."
            return
        }

        serverURL = originString(base)
        roomCode = code
        message = nil
        activePartyURL = url
    }

    func handleScan(_ rawValue: String) {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)

        if let scannedURL = URL(string: trimmed),
           let scheme = scannedURL.scheme?.lowercased(),
           scheme == "https" || scheme == "http",
           let host = scannedURL.host {
            var origin = URLComponents()
            origin.scheme = scheme
            origin.host = host
            origin.port = scannedURL.port

            if let originURL = origin.url {
                serverURL = originString(originURL)
            }

            if let components = URLComponents(url: scannedURL, resolvingAgainstBaseURL: false),
               let code = components.queryItems?.first(where: { $0.name.lowercased() == "code" })?.value {
                roomCode = normalizedCode(code)
            }

            if scannedURL.path == "/play" || scannedURL.path.hasSuffix("/play") {
                activePartyURL = scannedURL
                message = nil
                return
            }

            join()
            return
        }

        let code = normalizedCode(trimmed)
        if code.count == 4 {
            roomCode = code
            message = nil
        } else {
            message = "That QR code is not a CPI Party join link."
        }
    }

    func leaveController() {
        activePartyURL = nil
    }

    private func normalizedServerURL(_ value: String) -> URL? {
        var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        if !text.contains("://") {
            text = "https://" + text
        }

        guard var components = URLComponents(string: text),
              let scheme = components.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              components.host != nil else {
            return nil
        }

        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private func normalizedCode(_ value: String) -> String {
        String(value.uppercased().filter { $0.isLetter }.prefix(4))
    }

    private func originString(_ url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.string?.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? url.absoluteString
    }
}
