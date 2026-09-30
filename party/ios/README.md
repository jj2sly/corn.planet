# CPI Party for iPhone

CPI Party for iPhone is a native iOS shell around the existing CPI Party phone controller.

The web controller remains the source of truth for game-specific UI. The iOS shell adds the parts that are better handled natively:

- QR scanning with the iPhone camera
- manual room-code entry
- remembered Party server
- persistent WKWebView website data
- full-screen controller presentation
- native haptics when the controller loads
- screen-awake behavior while playing
- safe same-origin navigation
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
