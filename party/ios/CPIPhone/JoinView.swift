import SwiftUI
import UIKit

struct JoinView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showingScanner = false
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ZStack {
                orbitalBackground

                ScrollView {
                    VStack(spacing: 16) {
                        header
                        networkCard
                        joinCard
                        accessCard
                        settingsCard
                        footer
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 22)
                }
                .scrollIndicators(.hidden)
            }
            .task {
                if appState.serverOnline == nil {
                    await appState.checkServer()
                }
            }
            .sheet(isPresented: $showingScanner) {
                QRScannerView { value in
                    showingScanner = false
                    appState.handleScan(value)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                }
            }
        }
    }

    private var orbitalBackground: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            RadialGradient(
                colors: [Color.yellow.opacity(0.12), Color.clear],
                center: .topTrailing,
                startRadius: 10,
                endRadius: 420
            )
            .ignoresSafeArea()

            VStack {
                HStack {
                    Spacer()
                    Circle()
                        .stroke(Color.yellow.opacity(0.08), lineWidth: 1)
                        .frame(width: 290, height: 290)
                        .offset(x: 95, y: -100)
                }
                Spacer()
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("CPI")
                        .font(.system(size: 44, weight: .black, design: .rounded))

                    Text("MOBILE OPERATIONS")
                        .font(.caption.bold())
                        .tracking(2)
                        .foregroundStyle(.yellow)
                }

                Spacer()

                Text("CPST LINK")
                    .font(.caption2.monospaced().bold())
                    .foregroundStyle(.secondary)
            }

            Rectangle()
                .fill(Color.yellow.opacity(0.65))
                .frame(height: 1)

            Text("Corn Planet Institution // secure companion terminal")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
        }
        .padding(.top, 4)
    }

    private var networkCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("NETWORK STATUS", systemImage: "antenna.radiowaves.left.and.right")

            HStack(spacing: 12) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 11, height: 11)
                    .shadow(color: statusColor.opacity(0.5), radius: 5)

                VStack(alignment: .leading, spacing: 2) {
                    Text(appState.serverStatus.uppercased())
                        .font(.headline.monospaced().bold())

                    Text(serverDetail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Button {
                    impact()
                    Task { await appState.checkServer() }
                } label: {
                    if appState.checkingServer {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 58)
                    } else {
                        Text("CHECK")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(appState.checkingServer)
            }
        }
        .cpiCard()
    }

    private var serverDetail: String {
        guard let host = appState.normalizedServer?.host else { return "Server address needs attention" }
        return host
    }

    private var statusColor: Color {
        switch appState.serverOnline {
        case true: return .green
        case false: return .red
        case nil: return .yellow
        }
    }

    private var joinCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionLabel("JOIN PARTY", systemImage: "person.2.fill")

            Text("Scan the host display for the fastest join, or enter the four-letter room code.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Button {
                impact(.medium)
                showingScanner = true
            } label: {
                Label("SCAN HOST QR", systemImage: "qrcode.viewfinder")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            HStack(spacing: 10) {
                TextField("ABCD", text: $appState.roomCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(size: 28, weight: .bold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.join)
                    .onSubmit(joinParty)
                    .onChange(of: appState.roomCode) { value in
                        appState.roomCode = String(value.uppercased().filter { $0.isLetter }.prefix(4))
                    }

                if !appState.roomCode.isEmpty {
                    Button {
                        impact()
                        appState.clearRoomCode()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Clear room code")
                }
            }

            Button(action: joinParty) {
                HStack {
                    Text("JOIN WITH CODE")
                    Spacer()
                    Image(systemName: "arrow.right")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(appState.roomCode.count != 4)
        }
        .cpiCard(emphasized: true)
    }

    private var accessCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("CPI ACCESS", systemImage: "lock.shield")

            Text("Account sessions, Party settings, and sound preferences stay in the shared CPI web session instead of being duplicated by the app.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            portalButton(
                "ACCOUNT & STATS",
                detail: "Identity, clearance and Party history",
                systemImage: "person.crop.circle",
                requiresPartyServer: true,
                action: appState.openAccount
            )

            portalButton(
                "CPI DATABASE",
                detail: "Entities, incidents, personnel and artifacts",
                systemImage: "archivebox",
                requiresPartyServer: false,
                action: appState.openDatabase
            )

            portalButton(
                "HALL OF FAME",
                detail: "Saved group-night moments",
                systemImage: "star",
                requiresPartyServer: true,
                action: appState.openHall
            )

            portalButton(
                "PROMPTS & MODERATION",
                detail: "Prompts, sound mappings and moderator tools",
                systemImage: "slider.horizontal.3",
                requiresPartyServer: true,
                action: appState.openPrompts
            )
        }
        .cpiCard()
    }

    private func portalButton(
        _ title: String,
        detail: String,
        systemImage: String,
        requiresPartyServer: Bool,
        action: @escaping () -> Void
    ) -> some View {
        let unavailable = requiresPartyServer && appState.serverOnline == false
        return Button {
            impact()
            action()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .frame(width: 22)
                    .foregroundStyle(.yellow)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.bold())
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }

                Spacer()

                Image(systemName: unavailable ? "wifi.slash" : "chevron.right")
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .padding(.vertical, 5)
        .disabled(unavailable)
        .opacity(unavailable ? 0.5 : 1)
    }

    private var settingsCard: some View {
        DisclosureGroup(isExpanded: $showingSettings) {
            VStack(alignment: .leading, spacing: 12) {
                Text("PARTY SERVER")
                    .font(.caption.monospaced().bold())
                    .foregroundStyle(.secondary)

                TextField("https://your-party-server", text: $appState.serverURL)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)

                HStack {
                    Button("USE PUBLIC SERVER") {
                        impact()
                        appState.usePublicServer()
                        Task { await appState.checkServer() }
                    }
                    .buttonStyle(.bordered)

                    Spacer()

                    Text("Saved automatically")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Divider()

                Label("Party audio and moderation settings come from the same shared platform used by the browser and desktop host.", systemImage: "speaker.wave.2")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 12)
        } label: {
            sectionLabel("APP SETTINGS", systemImage: "gearshape")
        }
        .cpiCard()
    }

    private var footer: some View {
        VStack(spacing: 4) {
            Text("CPI MOBILE OPERATIONS")
                .font(.caption2.monospaced().bold())
                .foregroundStyle(.secondary)
            Text("Party controllers remain server-driven so every game stays in sync.")
                .font(.caption2)
                .foregroundStyle(.secondary.opacity(0.8))
                .multilineTextAlignment(.center)
        }
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    private func sectionLabel(_ text: String, systemImage: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.caption.monospaced().bold())
            .tracking(0.8)
            .foregroundStyle(.yellow)
    }

    private func joinParty() {
        guard appState.roomCode.count == 4 else {
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            return
        }
        impact(.medium)
        appState.join()
    }

    private func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }
}

private struct CPICardModifier: ViewModifier {
    let emphasized: Bool

    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.white.opacity(emphasized ? 0.075 : 0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(emphasized ? Color.yellow.opacity(0.5) : Color.white.opacity(0.12), lineWidth: 1)
                    )
            )
    }
}

private extension View {
    func cpiCard(emphasized: Bool = false) -> some View {
        modifier(CPICardModifier(emphasized: emphasized))
    }
}
