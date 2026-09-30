import SwiftUI

struct JoinView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showingScanner = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    VStack(spacing: 8) {
                        Text("CPI PARTY")
                            .font(.system(size: 34, weight: .black, design: .rounded))
                        Text("iPhone Controller")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 36)

                    Button {
                        showingScanner = true
                    } label: {
                        Label("SCAN HOST QR", systemImage: "qrcode.viewfinder")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("PARTY SERVER")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        TextField("https://your-party-server", text: $appState.serverURL)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("ROOM CODE")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        TextField("ABCD", text: $appState.roomCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.system(size: 30, weight: .bold, design: .monospaced))
                            .multilineTextAlignment(.center)
                            .textFieldStyle(.roundedBorder)
                            .onChange(of: appState.roomCode) { value in
                                appState.roomCode = String(value.uppercased().filter { $0.isLetter }.prefix(4))
                            }
                    }

                    Button("JOIN PARTY") {
                        appState.join()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)

                    if let message = appState.message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.orange)
                            .multilineTextAlignment(.center)
                    }

                    Text("The app uses the same CPI Party controller as /play, so game controls stay in sync with the website.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 8)
                }
                .padding(.horizontal, 24)
            }
            .background(Color.black)
            .sheet(isPresented: $showingScanner) {
                QRScannerView { value in
                    showingScanner = false
                    appState.handleScan(value)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                }
            }
        }
    }
}
