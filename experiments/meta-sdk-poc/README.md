# Meta Wearables DAT feasibility POC

Isolated iOS proof-of-concept for connecting Ray-Ban Meta glasses (Gen 1/Gen 2 and other DAT-supported models) with Meta’s official **Wearables Device Access Toolkit**. It verifies live camera frames and glasses-microphone audio.

**Flare Live:** after registration the app now opens on a hands-free Gemini Live call through the glasses (`CameraAccess/FlareLive/`), backed by the Night Shift server's `POST /api/gemini/glasses`. Architecture, verification status and the physical-device test are in [`docs/glasses-live.md`](../../docs/glasses-live.md). The diagnostics screen below is unchanged; open it with **Diagnostics (POC)** (UI tests launched with `--ui-testing` still start on it).

The native app is Meta’s public **CameraAccess** sample (SDK 1.0.1, commit `bbae597` of [facebook/meta-wearables-dat-ios](https://github.com/facebook/meta-wearables-dat-ios)), plus a feasibility HUD:

- live video **frame count** and **FPS**
- **DAT in-band** `audioFramePublisher` probe (PCM on the camera stream)
- **Bluetooth HFP** glasses-mic probe with an RMS level meter (phone mic is never used)

## What the official SDK actually supports

Evidence classes used below:

| Label | Meaning |
| --- | --- |
| **Docs** | Confirmed in [Wearables DAT documentation](https://wearables.developer.meta.com/docs/develop/dat/) |
| **Compiled** | Built locally with Xcode against DAT 1.0.1 |
| **Device** | Requires a physical iPhone + paired glasses + Meta AI app |
| **Unsupported / gated** | Documented limitation; do not treat as working until a device run says otherwise |

| Capability | Status |
| --- | --- |
| Native iOS SDK (`MWDATCore` + `MWDATCamera`) required for Ray-Ban Meta Gen 2 | **Docs.** Android DAT exists; this POC is iOS because this machine has Xcode. |
| Device discovery, Meta AI registration, `DeviceSession` | **Docs** + sample. **Device** to confirm with your glasses. |
| Live camera stream (`videoFramePublisher` / `Stream.start()`) | **Docs.** Frames travel over Wi-Fi or Bluetooth Classic, chosen by `Info.plist` (see [Stream transport](#stream-transport-bluetooth-classic-vs-wi-fi)); Bluetooth LE alone carries no video. **Device** to confirm live glasses video. Simulator/MockDeviceKit can show a test feed; that is **not** glasses video. |
| Photo capture while streaming | **Docs** + sample. Not the goal of this POC. |
| Glasses microphone via **Bluetooth HFP** (`AVAudioSession` `.allowBluetoothHFP`) | **Docs** ([Microphones and speakers](https://wearables.developer.meta.com/docs/develop/dat/microphones-and-speakers/)). Official sample records this into video. Phone mic is explicitly not a fallback. **Device** to confirm the level meter moves. |
| Glasses microphone **in-band on the camera stream** (`StreamConfiguration` audio codec + `audioFramePublisher`) | **Docs: beta.** Development/beta [release channels](https://wearables.developer.meta.com/docs/develop/dat/set-up-release-channels/) only. **Not supported in production channels.** API may change. **Device** + correct channel to confirm PCM. If no samples arrive, the HUD marks this **NOT SUPPORTED this session**. |
| Web / Next.js DAT client | **Unsupported.** DAT is a native mobile SDK. |
| Forwarding media into Gemini Live | **Unverified.** The SDK can give you video frames and (via HFP and/or beta in-band PCM) glasses audio. Wiring those buffers into `@google/genai` Live is out of scope. Suitable as a **native capture source**, not a drop-in for the existing web `/field` session. |

Do not treat video or audio as “working on glasses” until you have run the steps in [Physical device test](#physical-device-test).

## Prerequisites

- macOS with **Xcode 26.4+** (this checkout was prepared with Xcode 27.2)
- Swift 6.3+ / iOS **17.2+** deployment target
- Apple Developer team (free or paid) for signing on a physical iPhone
- **Meta AI** app on that iPhone, glasses paired, firmware and Meta AI versions matching [Version dependencies](https://wearables.developer.meta.com/docs/develop/dat/version-dependencies/)
- Ray-Ban Meta Wayfarer Gen 2 (or another DAT-supported pair)
- Network access the first time Xcode resolves `https://github.com/facebook/meta-wearables-dat-ios` (Swift Package 1.0.1)

Android is documented at [facebook/meta-wearables-dat-android](https://github.com/facebook/meta-wearables-dat-android) (`samples/CameraAccess`). It was not vendored here because this host has Xcode, not a verified Android SDK install.

## Meta developer registration

For **Developer Mode** (unpublished app, your glasses only):

1. In Meta AI: **Settings → App Info → tap App version five times → enable Developer Mode**. Confirm **Enable**.
2. Pair glasses in Meta AI. Check **Devices → gear → General → About → Version**.
3. You do **not** need Wearables Developer Center credentials in Developer Mode. `MetaAppID` / `ClientToken` stay as Xcode build settings (`$(META_APP_ID)` / `$(CLIENT_TOKEN)`).
4. Only **one** third-party Developer Mode app can stay registered. Registering this app unregisters any previous one.
5. After registration, the app appears under **Meta AI settings → App connections → Developer mode apps**.

For sharing with other testers you must create an organization and project at [wearables.developer.meta.com](https://wearables.developer.meta.com/), copy **Meta App ID** and **Client Token** into the `MWDAT` Info.plist keys, and use a [release channel](https://wearables.developer.meta.com/docs/develop/dat/set-up-release-channels/). In-band camera-stream audio is **not** in production channels.

## Signing (required before a phone run)

1. Open `experiments/meta-sdk-poc/ios/CameraAccess.xcodeproj` in Xcode.
2. Select the **CameraAccess** target → **Signing & Capabilities**.
3. Choose **your** Team. Change **Bundle Identifier** off `com.meta.wearables.external.CameraAccess` to something you own (Developer Mode does not require that Meta ID, but Apple signing does require a unique ID you can install).
4. This POC is configured for **Bluetooth Classic** streaming, which works with a free Personal Team. Do not add the Hotspot Configuration / Wi-Fi Info entitlements unless you switch to Wi-Fi (see below).

The sample URL scheme is `cameraaccess://` (`Info.plist` `MWDAT.AppLinkURLScheme` + `CFBundleURLTypes`). If you change the scheme, change both keys together.

## Stream transport: Bluetooth Classic vs Wi-Fi

DAT 1.0.x picks the camera-stream transport from `Info.plist`; there is no runtime API to select or read it ([#276](https://github.com/facebook/meta-wearables-dat-ios/issues/276), [#354](https://github.com/facebook/meta-wearables-dat-ios/issues/354), [#356](https://github.com/facebook/meta-wearables-dat-ios/issues/356)).

| | Bluetooth Classic (current) | Wi-Fi (upstream CameraAccess default) |
| --- | --- | --- |
| `Info.plist` | `external-accessory` in `UIBackgroundModes` + `UISupportedExternalAccessoryProtocols = com.meta.ar.wearable`. Wins even if the Wi-Fi keys are also present. | `NSLocalNetworkUsageDescription` + non-empty `NSBonjourServices`, and **no** Classic keys |
| Entitlements | none beyond `keychain-access-groups` | `com.apple.developer.networking.HotspotConfiguration` + `com.apple.developer.networking.wifi-info` |
| Apple team | free Personal Team works | **paid** Developer Program team (Personal Teams cannot sign those two entitlements) |
| Observable sign | no "Join network" prompt | iOS prompts to join the glasses' network on each stream start |
| Throughput | much lower; one report of ~7 fps at 360×640 with `.low` (#356). Latency unmeasured. This build still requests `hvc1 / .low / 24 fps` like the stock sample | higher bandwidth; not measured here |
| Shipping | development only; App Store needs MFi authorization for the accessory protocol | supported path for release |

Known Classic caveats from Meta: heap memory grows during a Classic stream and is only freed on relaunch ([#324](https://github.com/facebook/meta-wearables-dat-ios/issues/324)), so restart the app between long tests; heavy iPhone Wi-Fi traffic has been reported to delay the first frame and end the session ([#356](https://github.com/facebook/meta-wearables-dat-ios/issues/356)).

**Switch to Wi-Fi:** delete `external-accessory` and the `UISupportedExternalAccessoryProtocols` key from `Info.plist`, add both Wi-Fi entitlements back to `CameraAccess.entitlements`, and sign with a paid team. On a Personal Team that path ends in `Device is not connected` after the SDK's ~30 s link timeout, because iOS can never join the glasses' network.

## Run on a physical iPhone

```bash
cd experiments/meta-sdk-poc/ios
open CameraAccess.xcodeproj
```

In Xcode: select the connected iPhone (not a simulator for glasses) → Run (`Cmd+R`). Allow Bluetooth, Local Network, Microphone, and (for MockDeviceKit only) Camera prompts.

### Connect the glasses

1. Wear the glasses. They must already be connected in Meta AI.
2. Launch **Camera Access**.
3. Tap **Connect**. Meta AI opens for registration; approve; you return via `cameraaccess://`.
4. Status should show registration complete. SDK errors appear in the in-app alert.

### Live video

1. Tap **Start session**. Session chip should become `started` (green).
2. Tap **Preview**. Grant camera permission in Meta AI if asked.
3. The full-screen preview should show the glasses camera.
4. The **DAT feasibility** HUD must show **Video frames** incrementing and a non-zero FPS. If the image is static and the counter stays at 0, you do not have a live stream.

### Microphone: three audio diagnostic modes

The HUD has a mode selector (`VIDEO_ONLY` / `VIDEO_PCM` / `VIDEO_HFP`). It is locked while a session exists: each mode runs in its own fresh `DeviceSession` and `Camera`, and the app refuses a second Preview in the same session.

| Mode | DAT in-stream PCM | Bluetooth HFP | `StreamConfiguration` |
| --- | --- | --- | --- |
| `VIDEO_ONLY` (default) | off, no `audioFramePublisher` listener | off | `init(videoCodec: .hvc1, resolution: .low, frameRate: 24)`, the video-only initializer the upstream sample uses |
| `VIDEO_PCM` | `.pcm(sampleRate: .rate16000, numberOfChannels: 1)` | off | `init(videoCodec:audioCodec:resolution:frameRate:)`; needs the DAT **microphone** permission (Meta AI) as well as camera |
| `VIDEO_HFP` | off | opened, route awaited (≤3 s), then `stream.start()` | video-only initializer |

"Off" means released, not hidden. Before every session start, before every stream in a non-HFP mode, on mode change and when a session ends, the app stops the HFP engine and tap, removes its audio observers, deactivates `AVAudioSession` with `.notifyOthersOnDeactivation` and resets the category to `.soloAmbient`. The log line `audio released (…): hfpInputActive=…` proves the route state each time. Sound-in-video recording, which also opens HFP, is disabled outside `VIDEO_HFP`.

Meta's guidance ([#342](https://github.com/facebook/meta-wearables-dat-ios/issues/342), [android #206](https://github.com/facebook/meta-wearables-dat-android/issues/206)): on recent glasses software the glasses **end a DAT session when HFP comes up mid-session** and **refuse new sessions while HFP is held**; a glasses-side fix is rolling out. In-stream PCM is Meta's recommended mic path alongside the camera, but it is experimental and limited to development/beta release channels. Expect `VIDEO_HFP` to end with `Session ended by device` on affected firmware; that is a firmware result, not an app bug.

Stop Preview, tap **End session**, then **Disconnect** (gear menu) when finished. Backgrounding the app also ends the session.

## Stream diagnostics

Every registration, device, session, camera, stream, frame and audio-route event is logged with a wall-clock time and, during a stream attempt, seconds since `stream.start()`. Device identifiers are replaced by a short hash (`dev#xxxxxxxx`). Lines appear:

- in the HUD (last five lines), with **Copy diagnostics log** to put the full log on the clipboard;
- in Xcode's console when run from Xcode, and in Console.app under subsystem `CameraAccess.diagnostics`.

Each stream attempt ends with a `[summary]` line: `FRAMES RECEIVED` or `NO FRAMES`, mode, frame count, duration, last error, declared transport, PCM and HFP state.

### Transport: declared vs observed

The HUD transport is what `Info.plist` **declares**; DAT 1.0.1 has no API reporting what it selected (Meta, [#358](https://github.com/facebook/meta-wearables-dat-ios/issues/358)). Two runtime checks narrow it down, logged under `[transport]` after every attempt:

- `EA accessories connected=…, with com.meta.ar.wearable=…`: whether iOS exposes the glasses to this app as a Bluetooth Classic accessory. `0` means a Classic stream is impossible right now.
- `SDK log markers (…)`: the app reads its own unified log for the SDK's internal transport lines (`requestBTC success/failure`, `BTCSecureLink`, `EAConnection`, `SoftAP`, `falling back to SoftAP`, `WarpTransport: sent VideoStartRequest/AudioStartRequest`) and prints matches as `[sdklog]`. If the SDK doesn't log at that level the count is 0, which proves nothing either way. Xcode's console shows the same lines live; filter for `BTC`, `SoftAP` or `WarpTransport`.

### Audio isolation runs

Force-quit the app between modes (Classic memory growth, #324). Fold and unfold the glasses if a run hangs. The order matters: `VIDEO_ONLY` is the baseline.

| Run | Mode | Steps after selecting the mode | Reads as |
| --- | --- | --- | --- |
| 1 | `VIDEO_ONLY` | Start session → Preview → wait 30 s → Preview off → End session | Frames: video works, audio was the problem. No frames: audio is not the cause |
| 2 | `VIDEO_PCM` | Start session → Preview (approve microphone in Meta AI if it opens) → 30 s → Preview off → End session | `audioStreamingError` here but frames in run 1: in-stream PCM is unavailable on this channel/firmware |
| 3 | `VIDEO_HFP` | Start session → Preview (HFP opens first; allow iOS mic) → speak → 30 s → Preview off → End session | `Session ended by device` at HFP-up matches #342 |

## Simulator / MockDeviceKit

Debug builds show a ladybug control that opens Mock Device Kit. That can drive `CameraAccessTests` and a fake preview **without glasses**. A mock or `plant.mp4` feed is **not** evidence that Ray-Ban video or audio works.

## Build and test (no glasses)

From this repo, with Xcode selected:

```bash
cd experiments/meta-sdk-poc/ios
xcodebuild -scheme CameraAccess -destination 'generic/platform=iOS' -configuration Debug CODE_SIGNING_ALLOWED=NO build
xcodebuild test -scheme CameraAccess -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:CameraAccessTests/StreamFeasibilityTests
```

`ViewModelIntegrationTests` need MockDeviceKit on a simulator and can take several seconds; they still do not prove physical glasses capture.

**Local result (2026-11-07, Bluetooth Classic build):** unsigned `generic/platform=iOS` build and a Personal-Team-signed device build both **succeeded**. The signed app carries only `keychain-access-groups`, and its `Info.plist` declares Classic. `StreamFeasibilityTests` and `StreamDiagnosticsTests` (9 tests) **pass** on the iPhone 17 Pro Max simulator. `ViewModelIntegrationTests` pass under MockDeviceKit with the Classic `Info.plist` (first decoded frame about 1.5 s after `stream.start()`), but they are **flaky**: a different test misses a 5–10 s wait on some runs. Meta's unmodified upstream sample fails the same way. Run them with `-parallel-testing-enabled NO` on a booted simulator.

## Suitability for Gemini Live

Implemented as Flare Live; see [`docs/glasses-live.md`](../../docs/glasses-live.md). The original assessment:

A future native (or React Native) layer could:

1. Register and start a `DeviceSession`.
2. Start `camera.stream` and forward `VideoFrame` / `UIImage` / `CMSampleBuffer` into Gemini Live video input.
3. Forward glasses audio as PCM: prefer **HFP** for production-like voice (beamformed, 8/16 kHz mono); use **in-band DAT audio** only on development/beta channels if you need ambient sound time-aligned with video.

This cannot be done from the existing Next.js `/field` page alone. DAT will not run in the browser. Do not ship in-band camera audio on a production Meta release channel.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Connect does nothing / registration error | Developer Mode on; Meta AI installed; unique Dev Mode app; URL scheme matches. |
| Session never starts | Glasses on, charged, in Meta AI; firmware update chip if shown. |
| `Device is not connected` ~30 s after Preview | Stream link never came up. HUD should say **Bluetooth Classic**; if it says Wi-Fi on a Personal Team, that is the cause. See [Diagnostics](#stream-diagnostics). |
| `streaming` but 0 frames | On 1.0.x `streaming` only means setup finished; the log warns at 10/20/30 s. Check for a stray `stop()` in the log and repeat with audio off. |
| HFP meter dead | Mic permission; HFP started and settled; glasses selected as Bluetooth HFP input; do not use phone mic. |
| In-band audio dead | Expected on production channels. Confirm you are on a development/beta Wearables release channel if you need this path. |
| App Store | DAT currently uses ExternalAccessory; Meta documents App Store submission as unsupported. |

## Layout

```
experiments/meta-sdk-poc/
  README.md                 this file
  META_SDK_LICENSE          Meta Wearables developer terms from the SDK repo
  ios/                      adapted CameraAccess Xcode project
```

Sample source is copyright Meta Platforms, Inc. and affiliates, used under the terms in `META_SDK_LICENSE` and [Meta Wearables Developer Terms](https://wearables.developer.meta.com/terms).
