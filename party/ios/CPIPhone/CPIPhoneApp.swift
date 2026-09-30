import SwiftUI

@main
struct CPIPhoneApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .preferredColorScheme(.dark)
        }
    }
}

private struct RootView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Group {
            if let url = appState.activePartyURL {
                PartyWebScreen(url: url)
            } else {
                JoinView()
            }
        }
        .tint(.yellow)
    }
}
