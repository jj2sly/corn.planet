# CPI Party for iPhone

CPI Party for iPhone is the CPI mobile operations hub plus a native shell around the existing CPI Party phone controller.

The app home screen now provides quick access to Party joining, CPI account/stats, the CPI Database, Hall of Fame, prompts/moderation and saved server settings. The web controller remains the source of truth for game-specific UI, so Party game updates still reach the phone app without duplicating each controller in Swift.

The iOS shell adds the parts that are better handled natively:

- QR scanning with the iPhone camera
- manual room-code entry
- remembered Party server
- persistent WKWebView website data
- full-screen controller presentation
- native haptics when the controller loads
- screen-awake behavior while playing
- safe same-origin navigation
- embedded CPI account/database/management pages
- Party server health status and remembered server settings
- external links opened outside the embedded controller

## Requirements

- iOS 16 or newer
- Xcode 16 or newer recommended
- a reachable CPI Party server
- an Apple Developer account only when installing on devices through signing/TestFlight

## Open in Xcode

Open:

`party/ios/CPIPhone.xcodeproj`

Choose the **CPIPhone** scheme.

For a simulator build, no signing is required.

For a real iPhone:

1. Select the CPIPhone target.
2. Open Signing & Capabilities.
3. Choose your Apple Developer team.
4. If necessary, change the bundle identifier from `com.cornplanet.party.iphone` to an identifier owned by your team.
5. Run on the connected iPhone.

## Joining

The preferred flow is:

1. Host starts CPI Party on the desktop.
2. iPhone player opens CPI Party.
3. Tap **SCAN HOST QR**.
4. The app reads the existing `/play?code=XXXX` URL and opens the normal CPI controller.
5. Game-specific phone screens continue to come from the Party server.

A player can also enter the Party server and four-letter room code manually.

## Local/LAN servers

The app allows web content to load from a local network server so a phone can join a Party host running on the same LAN. The production Railway server should use HTTPS.

## Distribution

For the friend-group milestone, use TestFlight before App Store submission.

The repository CI only checks that the app compiles for the iOS Simulator. Producing a signed IPA/TestFlight build requires Apple signing credentials and should be added through GitHub encrypted secrets or Xcode Cloud, never committed to the repo.

## Architecture rule

Do not duplicate the six Party controller implementations in Swift.

When the website fixes a phone layout or game control, the iPhone app should receive the same fix automatically because it loads the existing `/play` client.


## TestFlight release workflow

GitHub Actions now includes **Publish CPI iPhone to TestFlight** at:

`.github/workflows/cpi-ios-testflight.yml`

It is manual-only (`workflow_dispatch`) so normal pushes do not upload builds to Apple.

Before the first TestFlight upload, create the App Store Connect app for bundle ID:

`com.cornplanet.party.iphone`

Then add these repository secrets:

- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_P8`
- `APPLE_DISTRIBUTION_CERTIFICATE_P12_BASE64`
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`

The workflow:

1. checks that every required secret exists
2. imports the Apple Distribution certificate into a temporary CI keychain
3. installs the App Store Connect API key only for the job
4. performs a simulator compile first
5. archives the signed iPhone app
6. exports the IPA
7. keeps the IPA as a short-lived GitHub artifact
8. uploads it to App Store Connect/TestFlight

No Apple credentials, private keys, certificates, or passwords belong in this repository.

### App icon

The CPI icon source is tracked as SVG in the Xcode asset catalog. A pre-build step converts it into the required 1024×1024 PNG before the asset catalog is compiled. This keeps the source editable while producing a valid iOS app icon for archives.
