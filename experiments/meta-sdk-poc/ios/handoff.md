# Handoff: iOS presentation-ready UI refactor (paused 2026-11-08 07:30)

Branch: `ws/w3/live-incident-response` (rebased on `origin/main`). Nothing committed or pushed.

## Goal (unchanged)
UI-only visual refactor of `experiments/meta-sdk-poc/ios/CameraAccess/`. Make it presentation-ready, with
a much larger glasses camera preview and the web app's look. **No business-logic changes**: do not touch
Gemini Live, the DAT SDK, capture/audio, backend calls, or state transitions. Do not edit web files.
Deployment target is **iOS 17.2** and Swift 6, so avoid iOS 18+ APIs.

## Do not touch: the user's in-progress work
These files were already modified before this refactor started. They are not part of it, so leave them
alone and do not commit them with it:
`FlareLive/FlareBackend.swift`, `FlareLive/FlareLiveController.swift`, `FlareLive/GeminiLiveClient.swift`,
`CameraAccessTests/FlareLiveE2ETests.swift`, `CameraAccessTests/FlareLiveTests.swift`.

## Done (refactor files)
- `Views/Components/FlareTheme.swift` is **new** and registered in `project.pbxproj` (4 lines, IDs
  `FACE…FA03/FA04`). The app target is *not* folder-synced, so any new file needs pbxproj entries.
  It holds the tokens mirrored from the web's `.band-dark` (`src/app/tokens.css`): `FlareSpace` (8-pt
  scale), `FlareRadius`, `FlareColor`, `flareDisplay(size:relativeTo:)`, `Font.flareMono`, `flareCard()`,
  `FlareSection`, `FlareSectionLabel`, `FlareDivider`, `FlareButtonStyle`, `FlareRowButtonStyle`.
- `FlareLive/FlareLiveView.swift` has a new layout:
  - **Pinned at the top:** the header and the glasses preview. The preview is full content width, fitted
    to the frame's aspect ratio, and capped at 46% of the height. It lives in the isolated
    `GlassesPreviewPanel`, so its ~8 fps updates re-render only that panel.
  - **Scrolling:** Glasses status, Call setup, Live telemetry (isolated `TelemetrySection`), Transcript
    (chat bubbles), Tools, and the © footer.
  - **Pinned at the bottom (`safeAreaInset`):** the error banner, the "Ask (typed)" button, and Start/End.
  - The phase badge sits under the title, so the header never reflows between phases.
- Restyled: `CustomButton`, `TipRow`, `CircleButton`, `FeasibilityHud`, `HomeScreenView` (dark theme;
  tip copy now describes the Flare flow), `MainAppView` (44-pt back button), `CameraView` (tokens,
  44-pt settings target, `ignoresSafeArea` instead of the deprecated `edgesIgnoringSafeArea`), and
  `CapturePreviewView` (the fixed 460-pt height is replaced by a safe-area layout where the media
  fills the available space at its own aspect ratio).
- The strings and identifiers pinned by the UI tests are preserved verbatim. A grep comparing old and
  new `FlareLiveView` confirms every action, `disabled` condition and visibility condition is unchanged.

## Fonts (decided; report this to the user)
- **ZT Moven is not bundled.** Its free Zelowtype licence excludes app embedding (see zelowtype.com/zt-moven).
  The fallback is SF Pro Expanded Bold Italic. `FlareTheme` switches to ZT Moven automatically if a copy
  licensed for apps is added to the bundle and listed under `UIAppFonts`.
- Geist and IBM Plex Mono exist only as Next.js build-cache WOFF2 subsets, so they are not bundleable.
  The fallbacks are SF Pro (system text styles) and SF Mono (`Font.flareMono`). No `Info.plist` change.

## Verified
- `build-for-testing` on the iPhone 17 Simulator is clean, with no warnings.
- Unit tests (`CameraAccessTests`): 33 total, 32 passed, 0 failed, 1 skipped (the E2E test skips itself
  without env vars).
- `FlareLiveUITests` passed, both the mock path and the **live E2E path** against `npm run dev` on
  :3000: Start Live, Live, the typed ask, End, then "Start Live again".
- Screenshots: before in `/tmp/flare-shots/before`, live run in `/tmp/flare-shots/live`, latest in
  `/tmp/flare-shots/after2`. These are temporary files.

## Pending
1. **Diagnostics UI suite not yet run green.** It was stopped twice because of slow, buffered output.
   It has 17 tests and needs about 5–8 minutes. Run it in the background and poll the terminal file:
   ```
   xcodebuild test-without-building -project CameraAccess.xcodeproj -scheme CameraAccess \
     -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath /tmp/flare-dd \
     -only-testing:CameraAccessUITests/CameraAccessUITests -parallel-testing-enabled NO 2>&1 \
     | rg --line-buffered "Test case .*(passed|failed)|TEST EXECUTE"
   ```
   Rebuild first with `build-for-testing … -derivedDataPath /tmp/flare-dd -quiet`. Get counts with
   `xcrun xcresulttool get test-results summary --path <latest .xcresult in /tmp/flare-dd/Logs/Test>`.
   The tests to watch exercise the styles this refactor changed: `close_preview_button`, `share_button`,
   `settings_button`/Disconnect, `record_button`, and the "Paused" text.
2. **Visual checks not done yet:** the home screen (unregistered), the diagnostics `CameraView`, the
   capture preview sheet, and a Dynamic Type accessibility size
   (`xcrun simctl ui <udid> content_size accessibility-large`). The home and diagnostics screens are only
   reachable by tapping, so use the `cursor-computer-use` tools on Simulator or a temporary local UI test.
3. Optionally rerun the live E2E on a small device (iPhone 17e) to check the 46% preview cap leaves
   enough transcript room. Add `TEST_RUNNER_FLARE_E2E_SERVER=http://localhost:3000`
   `TEST_RUNNER_FLARE_UI_SHOTS=<dir>` to the `FlareLiveUITests` run; this calls the real Gemini API.
4. Final diff review, then commit only the refactor files listed under "Done" plus `handoff.md` if
   wanted. Use a conventional commit ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
   (per `CLAUDE.md`), and open a PR with screenshots and a "How to test" section. Humans merge.

## Known limitations to report
- The glasses stream is portrait (9:16). At the 46% height cap it cannot fill the full width without
  cropping, so it is pillarboxed in a full-width black panel. It is still about 357 pt tall, up from 220.
- Auto-scroll still fires only when a transcript line is *added*, not while a Gemini line streams.
  That is existing behaviour and was kept, so a growing last bubble can sit partly under the action bar.

## Skills to read first
Repo skills live in `.agents/skills/<name>/SKILL.md` (repo root):
- `swiftui-layout-components`: layout, spacing, `safeAreaInset`, and no `GeometryReader` in lazy containers.
- `swiftui-patterns` (and `references/view-refactoring.md`): behaviour-preserving refactors.
- `ios-accessibility`: Dynamic Type, 44-pt targets, contrast, VoiceOver labels.
- `swiftui-performance`: keep the preview and telemetry updates isolated in their child views.
- `ios-simulator`: simctl boot, screenshots, content size, and status bar.
- `avkit`: `VideoPlayer` in `CapturePreviewView`.

User-level skills: `~/.agents/skills/frontend-design/SKILL.md`, `~/.cursor/skills/impeccable/SKILL.md`
(`CLAUDE.md` asks for these on UI work, with screenshot verification), and
`~/.agents/skills/conventional-commits/SKILL.md` for the commit.
Process skills: `~/.cursor/plugins/cache/cursor-public/superpowers/<hash>/skills/verification-before-completion/SKILL.md`.
