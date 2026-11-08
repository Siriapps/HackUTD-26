/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

import AVFoundation
import MWDATCamera
import MWDATCore
import Observation
import SwiftUI
import UIKit

extension TimeInterval {
  /// Formats a duration as `mm:ss`.
  var formattedRecordingTime: String {
    let minutes = Int(self) / 60
    let seconds = Int(self) % 60
    return String(format: "%02d:%02d", minutes, seconds)
  }
}

/// A capture awaiting preview/share — a still photo or a recorded video file.
/// Drives a single `.sheet(item:)` so photo and video share one presentation.
enum CapturePreview: Identifiable {
  case photo(UIImage)
  case video(URL)

  var id: String {
    switch self {
    case .photo: return "photo"
    case .video(let url): return "video:\(url.absoluteString)"
    }
  }
}

/// Drives the camera screen by exercising the SDK's camera lifecycle as explicit
/// steps: create/start a `DeviceSession`, add and start a `Stream`, capture or
/// record, stop the stream, end the session. Owns the screen-scoped pieces —
/// active-device monitoring, the `DeviceSession`, and its `Stream`. The UI binds to
/// the SDK's own `DeviceSessionState` / `StreamState` so the sample shows the real
/// state machine.
@Observable
@MainActor
final class CameraViewModel {
  // MARK: - Device

  /// Whether an eligible device is currently active. Drives the "Put on your
  /// glasses" placeholder. Sourced from the auto device selector.
  private(set) var hasActiveDevice: Bool = false

  // MARK: - Session state (bound directly to the SDK)

  /// The device session's state, mirrored from `DeviceSession.statePublisher`.
  /// `.idle`/`.stopped` mean no live session.
  var sessionState: DeviceSessionState = .idle

  // MARK: - Preview

  /// The latest decoded preview frame. Read only by the isolated `LivePreviewView`
  /// so the ~24fps updates don't re-render the whole screen.
  var currentVideoFrame: UIImage?
  var hasReceivedFirstFrame: Bool = false
  /// Proof the camera stream is live: total decoded frames and a 1-second FPS window.
  private(set) var videoFrameCount: Int = 0
  private(set) var videoFps: Double = 0
  /// DAT in-band `audioFramePublisher` (beta, development/beta channels only).
  private(set) var datInBandAudioStatus: String = "idle"
  private(set) var datInBandAudioSampleCount: Int = 0
  private(set) var datInBandAudioLevel: Float = 0
  /// Platform Bluetooth HFP path (documented glasses-mic capture; never phone mic).
  private(set) var hfpAudioStatus: String = "idle"
  private(set) var hfpAudioSampleCount: Int = 0
  private(set) var hfpAudioLevel: Float = 0
  private(set) var isHfpAudioTestRunning: Bool = false
  /// Audio path for the next session. Changeable only with no session, so every run uses a
  /// fresh `DeviceSession` and `Camera`. Switching releases whatever audio the old mode held.
  private(set) var audioMode: AudioDiagnosticMode = .videoOnly
  var includeInBandPcm: Bool { audioMode.usesInBandPcm }
  /// Transport the Info.plist declares; DAT exposes no API for the one it actually uses.
  let declaredTransport = DeclaredStreamTransport.from(infoDictionary: Bundle.main.infoDictionary ?? [:])

  /// The stream's state, mirrored from `Stream.statePublisher`. `.stopped` means
  /// no live stream.
  var streamState: StreamState = .stopped

  // MARK: - Capture preview

  /// The capture currently shown in the preview/share sheet (photo or video).
  var activePreview: CapturePreview?
  var isCapturingPhoto: Bool = false

  // MARK: - Video recording

  var isRecording: Bool = false
  /// Wall-clock start of the active recording (first written frame), mirrored from the
  /// recorder. Drives the isolated `RecordingTimerLabel`'s `TimelineView`, so the timer
  /// counts continuously — including through a stream pause. `nil` when not recording.
  var recordingStartDate: Date?
  /// Whether to record the glasses-microphone (Bluetooth HFP) audio into videos
  /// (sound-in-video). Toggled from the mic button shown while streaming. Recording with it on
  /// opens HFP, so it is only honored in `.videoHfp`.
  var includeAudioInStream: Bool = false
  /// Mic denied — iOS won't re-prompt. Drives the toggle's disabled look + tap-to-Settings.
  /// Still required for glasses audio: iOS gates HFP capture behind mic permission too.
  var micDenied: Bool { AVAudioApplication.shared.recordPermission == .denied }

  // MARK: - Errors

  /// Drives the single error alert. Uses the SDK's own `localizedDescription`
  /// rather than an app-maintained error map.
  var showError: Bool = false
  var errorMessage: String = ""

  /// Drives the confirm prompt shown before the camera-permission redirect to the
  /// Meta AI app — surfaced only when permission isn't already granted.
  var showCameraPermissionRedirectConfirm: Bool = false

  // MARK: - Derived session state

  var isSessionStarting: Bool { sessionState == .starting }
  var isSessionActive: Bool { sessionState == .started }
  /// A session exists and is connected (or connecting); a stream can be started.
  var hasSession: Bool {
    switch sessionState {
    case .starting, .started, .paused, .stopping: return true
    case .idle, .stopped: return false
    }
  }

  /// Human-readable session state for the status line.
  var sessionStateText: String { sessionState.description }

  // MARK: - Derived stream state

  var isStreaming: Bool { streamState == .streaming }
  /// A stream is attached (in any non-terminal state).
  var hasStream: Bool { streamState != .stopped }

  /// A session or stream start/stop is in flight. The UI shows a spinner and
  /// disables the controls until the SDK settles on a stable state, so transient
  /// states never need their own controls or labels.
  var isBusy: Bool {
    isSessionStarting || sessionState == .stopping
      || streamState == .starting || streamState == .waitingForDevice || streamState == .stopping
  }

  /// Human-readable stream state for the status line. `StreamState` has no
  /// `description`, so map it here.
  var streamStateText: String {
    switch streamState {
    case .streaming: return "streaming"
    case .starting: return "starting"
    case .waitingForDevice: return "waiting for device"
    case .stopping: return "stopping"
    case .stopped: return "stopped"
    case .paused: return "paused"
    }
  }

  /// The stream is paused (device-initiated, e.g. a single cap-touch tap). The
  /// last frame is retained, so the preview can stay on screen frozen.
  var isPaused: Bool { streamState == .paused }

  /// The preview surface (live frames, or the last held frame) should fill the
  /// screen: while streaming, while paused (frozen on the last frame), or while
  /// tearing down with a last frame so the stop loader overlays the preview.
  var showsLivePreview: Bool {
    isStreaming
      || ((streamState == .paused || streamState == .stopping) && currentVideoFrame != nil)
  }

  // MARK: - Private

  @ObservationIgnored private let wearables: WearablesInterface
  @ObservationIgnored private let deviceSelector: AutoDeviceSelector
  @ObservationIgnored private var deviceSession: DeviceSession?
  @ObservationIgnored private var camera: MWDATCamera.Camera?
  @ObservationIgnored private var isStoppingForBackground: Bool = false
  @ObservationIgnored private var backgroundStopSuppressionTask: Task<Void, Never>?

  @ObservationIgnored private let videoRecorder = VideoRecorder()
  // Decodes compressed hvc1 frames for on-screen preview. Not required for
  // recording — the passthrough writer handles compressed frames directly.
  @ObservationIgnored private let videoFrameDecoder = VideoFrameDecoder()
  @ObservationIgnored private let hfpAudioProbe = AudioInputHandler()
  @ObservationIgnored private var fpsWindowStart: Date?
  @ObservationIgnored private var fpsWindowFrameCount: Int = 0
  @ObservationIgnored private var undecodedFrameCount: Int = 0
  @ObservationIgnored private var lastFrameRateLog: Date?
  @ObservationIgnored private var lastStreamErrorText: String?
  @ObservationIgnored private var noFrameWatchdog: Task<Void, Never>?
  @ObservationIgnored private let audioTokenBag = ListenerTokenBag()
  @ObservationIgnored private var streamAttemptedInSession = false
  @ObservationIgnored private var sessionStartDate: Date?

  @ObservationIgnored private var deviceMonitorTask: Task<Void, Never>?
  @ObservationIgnored private var appLifecycleTask: Task<Void, Never>?
  @ObservationIgnored private let sessionTokenBag = ListenerTokenBag()
  @ObservationIgnored private let streamTokenBag = ListenerTokenBag()

  @ObservationIgnored private let photoCaptureFailureMessage =
    "Couldn't capture photo. There may not be enough storage, or another capture is in progress. Try again in a few moments."
  @ObservationIgnored private let backgroundStopErrorSuppressionTimeout: Duration

  // MARK: - Init

  init(
    wearables: WearablesInterface,
    backgroundStopErrorSuppressionTimeout: Duration = .seconds(5)
  ) {
    self.wearables = wearables
    self.deviceSelector = AutoDeviceSelector(wearables: wearables)
    self.backgroundStopErrorSuppressionTimeout = backgroundStopErrorSuppressionTimeout
    startDeviceMonitoring()
    startAppLifecycleMonitoring()
  }

  isolated deinit {
    deviceMonitorTask?.cancel()
    appLifecycleTask?.cancel()
    backgroundStopSuppressionTask?.cancel()
    noFrameWatchdog?.cancel()
    deviceSession?.stop()
  }

  // MARK: - Lifecycle step 1: session

  /// Creates and starts a `DeviceSession` (no stream yet). This is the first
  /// explicit step — a session can stay connected with no active stream. The
  /// state observer drives `sessionState`; we only seed an optimistic
  /// `.starting` so the UI reflects the in-flight request immediately.
  func selectAudioMode(_ mode: AudioDiagnosticMode) {
    guard !hasSession, mode != audioMode else { return }
    audioMode = mode
    includeAudioInStream = mode.usesHfp
    diag("mode", "audio mode -> \(mode.rawValue)")
    releaseAppAudio(reason: "mode change")
  }

  func startSession() {
    guard !hasSession else { return }
    // Meta (#342, android #206): with the HFP route held, the glasses refuse new sessions, and
    // HFP opening mid-session ends the session. Every mode starts with app audio released.
    releaseAppAudio(reason: "before session start")
    if StreamDiagnostics.isHfpInputActive() {
      diag("audio", "WARNING HFP input still in the route before createSession; another app may hold it")
    }
    streamAttemptedInSession = false
    sessionStartDate = Date()
    diag("mode", "session for \(audioMode.rawValue)")
    do throws(DeviceSessionError) {
      let session = try wearables.createSession(deviceSelector: deviceSelector)
      deviceSession = session
      // Subscribe before start() so no initial state transitions are missed.
      observeSession(session)
      // Reflect the in-flight request immediately; the observer drives it onward.
      sessionState = .starting
      diag("session", "session.start() called; \(StreamDiagnostics.buildConfigurationSummary())")
      try session.start()
    } catch {
      diag("session", "createSession/start threw \(error)")
      handleSessionError(error)
      sessionState = .idle
      cleanupSession()
    }
  }

  /// Stops the stream (if any) and ends the device session. `stop()` is terminal;
  /// the SDK cascades the stop to the stream and the state observers clean up
  /// when `.stopped` arrives.
  func endSession() {
    guard let session = deviceSession else { return }
    // Reflect the in-flight stop immediately so the controls disable at once; the
    // state observer drives it onward to `.stopped`.
    sessionState = .stopping
    Task {
      // The SDK requires cancelling the PCM listener before the camera stops; session.stop()
      // cascades to the camera.
      await cancelAudioFrameListener()
      diag("session", "session.stop() called")
      session.stop()
    }
  }

  // MARK: - Lifecycle step 2: stream

  /// Adds a `Stream` to the started session and starts it. Requires a session in
  /// `.started`. Camera permission is checked first (a query, no redirect); if it
  /// isn't already granted, the actual request — which redirects to the Meta AI
  /// app — is deferred to `confirmCameraPermissionRedirect()` so the app-switch is
  /// confirmed, not a surprise.
  func startStreaming() async {
    guard let session = deviceSession, session.state == .started else {
      showError("Start a session before previewing.")
      return
    }
    guard camera == nil else { return }
    guard !streamAttemptedInSession else {
      diag("mode", "refused: one stream attempt per session; end the session first")
      showError("Each diagnostic run needs a fresh session. Tap End session, then Start session.")
      return
    }

    do {
      let status = try await wearables.checkPermissionStatus(.camera)
      diag("permission", "camera permission status=\(status)")
      if status == .granted {
        await prepareAudioAndBeginStream(on: session)
      } else {
        showCameraPermissionRedirectConfirm = true
      }
    } catch {
      diag("permission", "checkPermissionStatus(.camera) threw \(error)")
      showError(error.localizedDescription)
    }
  }

  /// Confirmed from the permission prompt: requests camera access — this opens the
  /// Meta AI app and resumes when the user returns — then starts the stream if
  /// access was granted.
  func confirmCameraPermissionRedirect() async {
    showCameraPermissionRedirectConfirm = false
    guard let session = deviceSession, session.state == .started, camera == nil else { return }
    do {
      let status = try await wearables.requestPermission(.camera)
      diag("permission", "requestPermission(.camera) returned \(status)")
      guard status == .granted else {
        showError("Camera permission denied")
        return
      }
    } catch {
      diag("permission", "requestPermission(.camera) threw \(error)")
      showError(error.localizedDescription)
      return
    }
    await prepareAudioAndBeginStream(on: session)
  }

  /// Opens exactly the audio path the current mode calls for, then starts the stream.
  private func prepareAudioAndBeginStream(on session: DeviceSession) async {
    switch audioMode {
    case .videoOnly:
      releaseAppAudio(reason: "VIDEO_ONLY stream")
    case .videoPcm:
      releaseAppAudio(reason: "VIDEO_PCM stream")
      // In-stream audio needs the DAT microphone permission (granted in Meta AI), in addition
      // to camera.
      guard await ensureDatPermission(.microphone) else {
        showError("VIDEO_PCM needs the glasses microphone permission in Meta AI.")
        return
      }
    case .videoHfp:
      // Documented order: HFP route settled before stream.start().
      if !isHfpAudioTestRunning {
        await startHfpAudioTest()
      }
      let routed = await waitForHfpRoute(timeout: .seconds(3))
      diag("audio", "HFP route \(routed ? "up" : "NOT up after 3 s"); session state=\(session.state.description)")
      guard session.state == .started, deviceSession === session else {
        diag("mode", "session no longer started after HFP came up; stream not attempted")
        return
      }
    }
    beginStream(on: session)
  }

  private func ensureDatPermission(_ permission: Permission) async -> Bool {
    do {
      var status = try await wearables.checkPermissionStatus(permission)
      diag("permission", "\(permission) permission status=\(status)")
      if status != .granted {
        status = try await wearables.requestPermission(permission)
        diag("permission", "requestPermission(\(permission)) returned \(status)")
      }
      return status == .granted
    } catch {
      diag("permission", "\(permission) permission threw \(error)")
      return false
    }
  }

  private func waitForHfpRoute(timeout: Duration) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
      if StreamDiagnostics.isHfpInputActive() { return true }
      try? await Task.sleep(for: .milliseconds(100))
    }
    return StreamDiagnostics.isHfpInputActive()
  }

  /// Creates the camera `Stream` on the started session and starts it. Callers
  /// must have ensured camera permission is granted first.
  private func beginStream(on session: DeviceSession) {
    guard camera == nil else { return }
    streamAttemptedInSession = true
    let frameRate: UInt = 24
    // hvc1 for passthrough recording. Only VIDEO_PCM passes an audio codec (experimental DAT
    // in-band PCM, development/beta channels); the other modes use the video-only initializer.
    let config: StreamConfiguration
    if includeInBandPcm {
      config = StreamConfiguration(
        videoCodec: VideoCodec.hvc1,
        audioCodec: .pcm(sampleRate: .rate16000, numberOfChannels: 1),
        resolution: StreamingResolution.low,
        frameRate: frameRate
      )
    } else {
      config = StreamConfiguration(videoCodec: VideoCodec.hvc1, resolution: StreamingResolution.low, frameRate: frameRate)
    }
    datInBandAudioStatus = includeInBandPcm ? "waiting for audioFramePublisher" : "off (not requested)"
    datInBandAudioSampleCount = 0
    datInBandAudioLevel = 0
    videoFrameCount = 0
    videoFps = 0
    fpsWindowStart = nil
    fpsWindowFrameCount = 0
    undecodedFrameCount = 0
    lastFrameRateLog = nil
    lastStreamErrorText = nil

    StreamDiagnosticsLog.shared.beginAttempt()
    diag("stream", "attempt begins; \(StreamDiagnostics.buildConfigurationSummary())")
    diag(
      "stream",
      "mode=\(audioMode.rawValue) config hvc1 low @\(frameRate)fps audioCodec=\(includeInBandPcm ? "pcm16k mono" : "nil") "
        + "HFPtest=\(isHfpAudioTestRunning ? "running" : "off")"
    )
    logAudioRoute("at stream start")
    logDeviceSnapshot(session, context: "at stream start")

    do {
      // Add the consolidated `Camera` capability and stream through `camera.stream`.
      guard let newCamera = try session.addCamera(config: config) else {
        diag("camera", "addCamera returned nil")
        showError("Couldn't create the camera. Try again.")
        return
      }
      camera = newCamera
      newCamera.statePublisher.listen { [weak self] state in
        Task { @MainActor in self?.diag("camera", "camera state -> \(state)") }
      }.store(in: streamTokenBag)
      // Subscribe before start() so no initial state transitions are missed.
      setupStreamListeners(for: newCamera.stream)
      // Reflect the in-flight request immediately; the observer drives it onward.
      streamState = .starting
      diag("stream", "stream.start() called")
      newCamera.stream.start()
    } catch {
      diag("camera", "addCamera threw \(error)")
      camera = nil
      showError(error.localizedDescription)
    }
  }

  /// Starts Bluetooth HFP capture from the glasses microphone. The phone mic is
  /// never used: AudioInputHandler installs a tap only when the active input is
  /// `.bluetoothHFP`. DAT docs require HFP to settle before a camera stream; if a
  /// stream is already running this is still a valid feasibility probe.
  func toggleHfpAudioTest() {
    if isHfpAudioTestRunning {
      stopHfpAudioTest()
      return
    }
    Task { await startHfpAudioTest() }
  }

  func startHfpAudioTest() async {
    guard !isHfpAudioTestRunning else { return }
    guard audioMode.usesHfp else {
      diag("audio", "HFP refused: mode is \(audioMode.rawValue)")
      return
    }

    let granted = await withCheckedContinuation { continuation in
      AVAudioApplication.requestRecordPermission { granted in
        continuation.resume(returning: granted)
      }
    }
    guard granted else {
      diag("audio", "HFP test refused: iOS microphone permission denied")
      hfpAudioStatus = "NOT SUPPORTED — iOS microphone permission denied (required for HFP)"
      return
    }

    hfpAudioSampleCount = 0
    hfpAudioLevel = 0
    hfpAudioStatus = "starting HFP route…"
    isHfpAudioTestRunning = true
    diag("audio", "HFP test starting (stream state=\(streamStateText))")

    hfpAudioProbe.setCallbacks(
      onAudioBuffer: { [weak self] samples, _, _ in
        let level = StreamFeasibility.rmsLevel(samples)
        Task { @MainActor in
          guard let self, self.isHfpAudioTestRunning else { return }
          self.hfpAudioSampleCount += 1
          self.hfpAudioLevel = level
          self.hfpAudioStatus = "HFP samples arriving"
          if self.hfpAudioSampleCount == 1 {
            self.diag("audio", "first HFP buffer received")
          }
        }
      },
      onInterruptionResume: {},
      onGlassesAudioUnavailable: { [weak self] in
        Task { @MainActor in
          guard let self else { return }
          self.diag("audio", "glasses HFP input not active")
          self.hfpAudioStatus =
            "NOT SUPPORTED on this route — glasses HFP mic not active (phone mic is never used)"
        }
      }
    )
    hfpAudioProbe.setup()
    hfpAudioProbe.setupInput()
    hfpAudioProbe.startListening()
    logAudioRoute("after HFP start")
  }

  func stopHfpAudioTest() {
    guard isHfpAudioTestRunning else { return }
    hfpAudioProbe.stopListening()
    hfpAudioProbe.cleanup()
    isHfpAudioTestRunning = false
    diag("audio", "HFP test stopped after \(hfpAudioSampleCount) buffers")
    if hfpAudioSampleCount == 0 {
      hfpAudioStatus = "stopped — no HFP samples received"
    } else {
      hfpAudioStatus = "stopped — \(hfpAudioSampleCount) buffers"
    }
  }

  func clearDiagnostics() {
    StreamDiagnosticsLog.shared.clear()
  }

  /// Stops the camera stream but keeps the `DeviceSession` connected, so
  /// streaming can be started again without re-creating the session. The stream
  /// `.stopped` observer performs the teardown — we don't eagerly reset here.
  func stopStreaming() {
    guard let activeCamera = camera else { return }
    videoRecorder.prepareToStop()
    stopHfpAudioTest()
    // Reflect the in-flight request immediately; the observer drives it onward.
    streamState = .stopping
    Task {
      await cancelAudioFrameListener()
      diag("camera", "camera.stop() called by user")
      // Stopping the camera cascades to its stream child and detaches the camera from the
      // session, so streaming can be started again with a fresh `addCamera()`.
      activeCamera.stop()
    }
  }

  /// The SDK asks for the PCM listener to be cancelled before the camera stops.
  private func cancelAudioFrameListener() async {
    guard includeInBandPcm else { return }
    await audioTokenBag.cancelAll()
    diag("audio", "audioFramePublisher listener cancelled")
  }

  /// Stops every app-side audio path and hands the audio session back, so a mode that should
  /// have no audio really has none: HFP engine and tap stopped, session deactivated, and the
  /// category reset so `.allowBluetoothHFP` no longer applies.
  private func releaseAppAudio(reason: String) {
    stopHfpAudioTest()
    hfpAudioProbe.cleanup()
    let audioSession = AVAudioSession.sharedInstance()
    do {
      try audioSession.setActive(false, options: .notifyOthersOnDeactivation)
      try audioSession.setCategory(.soloAmbient, mode: .default, options: [])
    } catch {
      diag("audio", "audio release (\(reason)) error: \(error.localizedDescription)")
    }
    logAudioRoute("audio released (\(reason))")
  }

  // MARK: - Capture

  func capturePhoto() {
    guard !isCapturingPhoto, isStreaming else {
      showError(photoCaptureFailureMessage)
      return
    }
    isCapturingPhoto = true
    let success = camera?.stream.capturePhoto(format: .jpeg) ?? false
    if !success {
      isCapturingPhoto = false
      showError(photoCaptureFailureMessage)
    }
  }

  func toggleRecording() {
    if isRecording {
      Task { await stopVideoRecording() }
    } else {
      startVideoRecording()
    }
  }

  func startVideoRecording() {
    guard isStreaming, !isRecording else { return }
    // Flip the intent flag synchronously so the toggle and UI don't lag the
    // frame-driven recorder; the file starts on the next frame.
    isRecording = true
    // If the glasses mic isn't available, flip the mic off so the button reflects that this
    // recording is video-only (the phone mic is never used). Left off afterward — the user can
    // re-tap the mic to turn it back on.
    videoRecorder.prepareToStart(includeAudio: includeAudioInStream && audioMode.usesHfp) { [weak self] in
      Task { @MainActor in self?.includeAudioInStream = false }
    }
  }

  func stopVideoRecording() async {
    guard isRecording else { return }
    isRecording = false
    recordingStartDate = nil
    // The writer starts on the first frame after the shutter opens. If stop lands
    // before that frame arrives, wait briefly (shutter still open) so even a quick
    // recording finalizes to a file and reliably opens the preview.
    var elapsedNanos: UInt64 = 0
    while !videoRecorder.isRecording, elapsedNanos < 500_000_000 {
      try? await Task.sleep(nanoseconds: 25_000_000)
      elapsedNanos += 25_000_000
    }
    // Show a preview/share sheet (mirrors the photo flow) for the finalized file.
    switch await videoRecorder.stopRecording() {
    case .completed(let url):
      activePreview = .video(url)
    case .noRecording:
      // Reached only after the intent guard + start wait, so while streaming this
      // means the recording never started (e.g. the writer failed to start).
      showError("Couldn't start recording. Try again.")
    case .failed:
      showError("Recording couldn't be saved. Try again.")
    }
  }

  // MARK: - Dismissers

  func dismissError() {
    showError = false
  }

  func dismissCapturePreview() {
    guard let preview = activePreview else { return }
    activePreview = nil
    discardPreview(preview)
  }

  /// Deletes a finished video capture's temporary file. Photos are held in
  /// memory, so there's nothing on disk to remove for them.
  func discardPreview(_ preview: CapturePreview) {
    if case .video(let url) = preview {
      try? FileManager.default.removeItem(at: url)
    }
  }

  // MARK: - Device monitoring

  /// Monitors device availability only — does NOT create sessions. Session
  /// creation is deferred to `startSession()` to avoid races.
  private func startDeviceMonitoring() {
    deviceMonitorTask = Task { [weak self] in
      guard let self else { return }
      for await deviceId in deviceSelector.activeDeviceStream() {
        hasActiveDevice = deviceId != nil
      }
    }
  }

  private func startAppLifecycleMonitoring() {
    appLifecycleTask = Task { [weak self] in
      guard let self else { return }
      for await _ in NotificationCenter.default.notifications(named: UIApplication.didEnterBackgroundNotification) {
        self.handleDidEnterBackground()
      }
    }
  }

  private func handleDidEnterBackground() {
    guard hasSession, hasStream, sessionState != .stopping else { return }

    diag("app", "entered background; ending session")
    beginBackgroundStopErrorSuppression()
    endSession()
  }

  private func beginBackgroundStopErrorSuppression() {
    isStoppingForBackground = true
    backgroundStopSuppressionTask?.cancel()
    let timeout = backgroundStopErrorSuppressionTimeout
    backgroundStopSuppressionTask = Task { @MainActor [weak self] in
      try? await Task.sleep(for: timeout)
      guard let self, !Task.isCancelled else { return }
      // Bound the suppression window so a stalled teardown cannot hide
      // unrelated later errors indefinitely.
      self.isStoppingForBackground = false
      self.backgroundStopSuppressionTask = nil
    }
  }

  private func endBackgroundStopErrorSuppression() {
    backgroundStopSuppressionTask?.cancel()
    backgroundStopSuppressionTask = nil
    isStoppingForBackground = false
  }

  // MARK: - Session observation

  private func observeSession(_ session: DeviceSession) {
    session.statePublisher.listen { [weak self] state in
      Task { @MainActor in self?.handleSessionStateChange(state) }
    }.store(in: sessionTokenBag)
    session.errorPublisher.listen { [weak self] error in
      Task { @MainActor in self?.handleSessionError(error) }
    }.store(in: sessionTokenBag)
  }

  private func handleSessionStateChange(_ state: DeviceSessionState) {
    diag("session", "session state -> \(state.description)")
    if state == .started, let session = deviceSession {
      logDeviceSnapshot(session, context: "session started")
    }
    sessionState = state
    if state == .stopped {
      endBackgroundStopErrorSuppression()
      cleanupSession()
    }
  }

  private func handleSessionError(_ error: DeviceSessionError) {
    diag("session", "session error: \(error)")
    // Backgrounding the app intentionally ends the preview session; the SDK can
    // still emit teardown errors while that stop converges, and surfacing those
    // would show a false "something went wrong" alert on return.
    guard !isStoppingForBackground else { return }
    // All session errors surface through the single alert, including
    // `datAppOnTheGlassesUpdateRequired`, which the SDK delivers as a one-shot event.
    showError(error.localizedDescription)
  }

  /// Terminal session cleanup — drop the reference and observers so the next
  /// `startSession()` creates a fresh session.
  private func cleanupSession() {
    sessionTokenBag.clear()
    deviceSession = nil
    streamAttemptedInSession = false
    releaseAppAudio(reason: "session ended")
  }

  // MARK: - Stream observation

  private func setupStreamListeners(for stream: MWDATCamera.Stream) {
    stream.statePublisher.listen { [weak self] state in
      Task { @MainActor in self?.handleStreamStateChange(state) }
    }.store(in: streamTokenBag)

    stream.videoFramePublisher.listen { [weak self] frame in
      guard let self else { return }

      // Append to the recorder (no-op unless recording) off the main actor so it
      // keeps writing while the app is backgrounded.
      self.appendVideoFrame(frame)

      // Decode the compressed hvc1 frame for preview off the main actor.
      let previewImage = self.videoFrameDecoder.decode(frame.sampleBuffer)

      Task { @MainActor [weak self] in
        guard let self else { return }
        self.noteVideoFrame(decoded: previewImage != nil)
        // Keep the live surface stable while a capture preview is onscreen.
        if UIApplication.shared.applicationState != .background,
          activePreview == nil,
          !isCapturingPhoto,
          let image = previewImage
        {
          self.currentVideoFrame = image
          if !self.hasReceivedFirstFrame {
            self.hasReceivedFirstFrame = true
          }
        }
        // Capture the actual recording start (first written frame) once, so the timer
        // anchors to the clip's start and matches its duration.
        if self.isRecording, self.recordingStartDate == nil {
          self.recordingStartDate = self.videoRecorder.recordingStartDate
        }
      }
    }.store(in: streamTokenBag)

    stream.errorPublisher.listen { [weak self] error in
      Task { @MainActor in self?.handleStreamError(error) }
    }.store(in: streamTokenBag)

    stream.photoDataPublisher.listen { [weak self] data in
      Task { @MainActor in self?.handlePhotoData(data) }
    }.store(in: streamTokenBag)

    guard includeInBandPcm else { return }
    stream.audioFramePublisher.listen { [weak self] frame in
      let buffer = frame.pcmBuffer
      guard let channel = buffer.floatChannelData?[0] else { return }
      let samples = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
      let level = StreamFeasibility.rmsLevel(samples)
      Task { @MainActor in
        guard let self else { return }
        self.datInBandAudioSampleCount += 1
        self.datInBandAudioLevel = level
        self.datInBandAudioStatus = "in-band PCM arriving"
        if self.datInBandAudioSampleCount == 1 {
          self.diag("audio", "first in-band PCM buffer received")
        }
      }
    }.store(in: audioTokenBag)
  }

  private func noteVideoFrame(decoded: Bool) {
    videoFrameCount += 1
    if !decoded {
      undecodedFrameCount += 1
    }
    let now = Date()
    if videoFrameCount == 1 {
      diag("frames", "FIRST VIDEO FRAME (decoded=\(decoded))")
      logAudioRoute("at first frame")
      lastFrameRateLog = now
    } else if let last = lastFrameRateLog, now.timeIntervalSince(last) >= 5 {
      diag("frames", "frames=\(videoFrameCount) fps=\(String(format: "%.1f", videoFps)) undecoded=\(undecodedFrameCount)")
      lastFrameRateLog = now
    }
    if fpsWindowStart == nil {
      fpsWindowStart = now
      fpsWindowFrameCount = 0
    }
    fpsWindowFrameCount += 1
    if let start = fpsWindowStart {
      let elapsed = now.timeIntervalSince(start)
      if elapsed >= 1 {
        videoFps = StreamFeasibility.framesPerSecond(frameCount: fpsWindowFrameCount, elapsedSeconds: elapsed)
        fpsWindowStart = now
        fpsWindowFrameCount = 0
      }
    }
  }

  private func handleStreamStateChange(_ state: StreamState) {
    streamState = state
    diag("stream", "stream state -> \(streamStateText) (frames so far=\(videoFrameCount))")
    if state == .streaming {
      startNoFrameWatchdog()
    }
    if state == .stopped {
      logAttemptSummary()
      // Terminal — finalize any recording, then converge teardown. Covers both
      // user-initiated stop and SDK auto-stop (disconnect, error, session end).
      Task { await stopVideoRecording() }
      clearStreamResources()
    }
  }

  /// On DAT 1.0.x `.streaming` means setup finished, not that video is arriving, and the SDK
  /// has no first-frame timeout — so flag a silent zero-frame stream explicitly.
  private func startNoFrameWatchdog() {
    noFrameWatchdog?.cancel()
    noFrameWatchdog = Task { @MainActor [weak self] in
      for checkpoint in [10, 20, 30] {
        try? await Task.sleep(for: .seconds(10))
        guard let self, !Task.isCancelled, self.streamState == .streaming else { return }
        guard self.videoFrameCount == 0 else { return }
        self.diag("frames", "WARNING streaming for \(checkpoint)s with 0 frames")
        self.logAudioRoute("during zero-frame stream")
      }
    }
  }

  private func logAttemptSummary() {
    let elapsed = StreamDiagnosticsLog.shared.elapsedInAttempt.map { String(format: "%.1fs", $0) } ?? "n/a"
    let outcome = videoFrameCount > 0 ? "FRAMES RECEIVED" : "NO FRAMES"
    diag(
      "summary",
      "\(outcome) mode=\(audioMode.rawValue): frames=\(videoFrameCount) undecoded=\(undecodedFrameCount) "
        + "duration=\(elapsed) lastError=\(lastStreamErrorText ?? "none") "
        + "declaredTransport=\(declaredTransport.label) "
        + "PCM=\(includeInBandPcm ? "on" : "off") PCMbuffers=\(datInBandAudioSampleCount) "
        + "HFPtest=\(isHfpAudioTestRunning ? "running" : "off") HFPbuffers=\(hfpAudioSampleCount) "
        + "hfpInputActive=\(StreamDiagnostics.isHfpInputActive())"
    )
    StreamDiagnosticsLog.shared.endAttempt()
    logSdkTransportEvidence()
  }

  /// Scans this process's unified log for the SDK's own transport lines since the session
  /// started, which is the closest available evidence of the transport actually used.
  private func logSdkTransportEvidence() {
    let since = (sessionStartDate ?? Date()).addingTimeInterval(-2)
    diag("transport", AccessoryEvidence.summary())
    Task.detached(priority: .utility) {
      let result = SDKTransportEvidence.collect(since: since)
      await MainActor.run {
        let log = StreamDiagnosticsLog.shared
        guard result.scannedEntries >= 0 else {
          log.log("transport", "OSLogStore unavailable; check Xcode console / Console.app for BTC/SoftAP lines")
          return
        }
        log.log(
          "transport",
          "SDK log markers (\(result.lines.count) of \(result.scannedEntries) entries): \(SDKTransportEvidence.classify(result.lines))"
        )
        for line in result.lines {
          log.log("sdklog", line)
        }
      }
    }
  }

  /// Single stream-teardown convergence point.
  private func clearStreamResources() {
    noFrameWatchdog?.cancel()
    noFrameWatchdog = nil
    streamTokenBag.clear()
    audioTokenBag.clear()
    // Detach the camera (idempotent) so a subsequent addCamera() can register a new one. On the
    // user-stop and session-end paths the camera is already stopped, so this is a no-op; it is
    // load-bearing only when the stream terminates on its own (a stream-level error while the
    // session stays connected), since teardown cascades parent->child but not child->parent.
    if camera != nil {
      diag("camera", "teardown: camera.stop() (idempotent)")
    }
    camera?.stop()
    camera = nil
    streamState = .stopped
    currentVideoFrame = nil
    hasReceivedFirstFrame = false
    fpsWindowStart = nil
    fpsWindowFrameCount = 0
    if !includeInBandPcm {
      datInBandAudioStatus = "off (not requested)"
    } else if datInBandAudioSampleCount == 0 {
      datInBandAudioStatus =
        "NOT SUPPORTED this session — no audioFramePublisher samples (beta; not in production channels)"
    } else {
      datInBandAudioStatus = "stopped — \(datInBandAudioSampleCount) PCM buffers"
    }
    stopHfpAudioTest()
  }

  /// Appends a frame to the recorder. `nonisolated` so it keeps writing while the
  /// app is backgrounded (the recorder is thread-safe).
  nonisolated private func appendVideoFrame(_ frame: VideoFrame) {
    videoRecorder.appendVideoFrame(frame.sampleBuffer)
  }

  private func handleStreamError(_ error: StreamError) {
    let described = Self.redactedDescription(of: error)
    lastStreamErrorText = described
    diag("stream", "STREAM ERROR \(described) (frames so far=\(videoFrameCount))")
    if case .deviceNotConnected = error {
      // On 1.0.x every failure to bring up the stream link surfaces as deviceNotConnected,
      // after DAT's ~30 s link timeout (Meta, issues #240/#276/#354).
      diag("stream", "hint: stream link never came up; for Wi-Fi this is the glasses hotspot join")
    }
    if case .audioStreamingError = error {
      diag(
        "stream",
        "hint: in-stream audio failed (mode=\(audioMode.rawValue), hfpInputActive=\(StreamDiagnostics.isHfpInputActive())); "
          + "rerun as VIDEO_ONLY to see whether video works without it"
      )
    }
    diag("transport", "at error: \(AccessoryEvidence.summary())")
    if let session = deviceSession {
      logDeviceSnapshot(session, context: "at stream error")
    }
    logAudioRoute("at stream error")
    // Same bounded suppression window as `handleSessionError`: hide only the
    // expected teardown noise from an intentional background-driven stop.
    guard !isStoppingForBackground else { return }
    showError(error.localizedDescription)
  }

  // MARK: - Diagnostics

  private func diag(_ category: String, _ message: String) {
    StreamDiagnosticsLog.shared.log(category, message)
  }

  private func logAudioRoute(_ context: String) {
    diag(
      "audio",
      "\(context): hfpInputActive=\(StreamDiagnostics.isHfpInputActive()) \(StreamDiagnostics.audioRouteSummary())"
    )
  }

  private func logDeviceSnapshot(_ session: DeviceSession, context: String) {
    guard let device = session.device else {
      diag("device", "\(context): session.device is nil")
      return
    }
    diag(
      "device",
      "\(context): \(StreamDiagnostics.redact(device.identifier)) type=\(device.deviceType()) "
        + "link=\(device.linkState) compat=\(device.compatibility()) don=\(device.donState) "
        + "hinge=\(device.hingeState) battery=\(device.batteryLevel.map(String.init) ?? "?") "
        + "thermal=\(device.thermalLevel)"
    )
  }

  /// `StreamError`'s own description embeds the raw device identifier; hash it for logs.
  private static func redactedDescription(of error: StreamError) -> String {
    switch error {
    case .deviceNotConnected(let id): return "deviceNotConnected(\(StreamDiagnostics.redact(id)))"
    case .deviceNotFound(let id): return "deviceNotFound(\(StreamDiagnostics.redact(id)))"
    default: return String(describing: error)
    }
  }

  private func handlePhotoData(_ data: PhotoData) {
    isCapturingPhoto = false
    if let image = UIImage(data: data.data) {
      activePreview = .photo(image)
    }
  }

  private func showError(_ message: String) {
    errorMessage = message
    showError = true
  }
}
