import SwiftUI

struct JoinView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showingScanner = false
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    header
                    statusCard
                    joinCard
                    portalCard
                    settingsCard

                    if let message = appState.message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.orange)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
            .background(Color.black)
            .task {
                await appState.checkServer()
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

    private var header: some View {
        VStack(spacing: 6) {
            Text("CPI")
                .font(.system(size: 42, weight: .black, design: .rounded))
            Text("CORN PLANET INSTITUTION")
                .font(.caption.bold())
                .tracking(1.5)
                .foregroundStyle(.secondary)
            Text("Mobile Operations")
                .font(.headline)
                .foregroundStyle(.yellow)
        }
        .padding(.top, 12)
    }

    private var statusCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("PARTY NETWORK")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text(appState.serverStatus.uppercased())
                    .font(.headline.bold())
            }

            Spacer()

            Circle()
                .fill(statusColor)
                .frame(width: 12, height: 12)

            Button("CHECK") {
                Task { await appState.checkServer() }
            }
            .buttonStyle(.bordered)
        }
        .padding()
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private var statusColor: Color {
        switch appState.serverOnline {
        case true: return .green
        case false: return .red
        case nil: return .yellow
        }
    }

    private var joinCard: some View {
        VStack(spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("JOIN PARTY")
                        .font(.title3.bold())
                    Text("Use the host QR or enter a room code.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            Button {
                showingScanner = true
            } label: {
                Label("SCAN HOST QR", systemImage: "qrcode.viewfinder")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            TextField("ROOM CODE", text: $appState.roomCode)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .font(.system(size: 28, weight: .bold, design: .monospaced))
                .multilineTextAlignment(.center)
                .textFieldStyle(.roundedBorder)
                .onChange(of: appState.roomCode) { value in
                    appState.roomCode = String(value.uppercased().filter { $0.isLetter }.prefix(4))
                }

            Button("JOIN WITH CODE") {
                appState.join()
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .frame(maxWidth: .infinity)
        }
        .padding()
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private var portalCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("CPI ACCESS")
                .font(.title3.bold())

            Text("Use the same CPI systems from the phone app.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            portalButton("ACCOUNT & STATS", systemImage: "person.crop.circle", action: appState.openAccount)
            portalButton("CPI DATABASE", systemImage: "archivebox", action: appState.openDatabase)
            portalButton("HALL OF FAME", systemImage: "star", action: appState.openHall)
            portalButton("PROMPTS & MODERATION", systemImage: "slider.horizontal.3", action: appState.openPrompts)
        }
        .padding()
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private func portalButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
    }

    private var settingsCard: some View {
        DisclosureGroup("SETTINGS", isExpanded: $showingSettings) {
            VStack(alignment: .leading, spacing: 10) {
                Text("PARTY SERVER")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                TextField("https://your-party-server", text: $appState.serverURL)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)

                HStack {
                    Button("CHECK SERVER") {
                        Task { await appState.checkServer() }
                    }
                    .buttonStyle(.bordered)

                    Spacer()

                    Text("Saved automatically")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.top, 10)
        }
        .padding()
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
}
