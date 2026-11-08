/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Reusable Meta DAT capture for the Live session: device session, camera stream, decoded
 * video frames and the glasses microphone (DAT in-stream PCM or Bluetooth HFP). The lifecycle,
 * ordering and teardown rules are lifted from the verified feasibility POC (CameraViewModel):
 *  - app audio is released before a session starts (glasses refuse sessions while HFP is held),
 *  - HFP, when used, settles before stream.start(),
 *  - the PCM listener is cancelled before the camera stops.
 * The phone microphone is never used.
 */

import AVFoundation
import MWDATCamera
import MWDATCore
import Observation
import UIKit

@Observable
@MainActor
final class GlassesCapture: FieldMediaSource {
  let kind = MediaSourceKind.metaGlasses

  private(set) var hasActiveDevice = false
  private(set) var sessionState: DeviceSessionState = .idle
  private(set) var streamState: StreamState = .stopped
  private(set) var micPath: GlassesMicPath?
  /// HFP route reached the glasses (HFP path only).
  private(set) var hfpRouteUp = false

  @ObservationIgnored nonisolated(unsafe) var onVideoFrame: (@Sendable (UIImage) -> Void)?
  @ObservationIgnored nonisolated(unsafe) var onMicSamples: (@Sendable ([Float], Double) -> Void)?
  @ObservationIgnored var onEnded: (@MainActor (String) -> Void)?

  @ObservationIgnored private let wearables: WearablesInterface
  @ObservationIgnored private let deviceSelector: AutoDeviceSelector
  @ObservationIgnored private var deviceSession: DeviceSession?
  @ObservationIgnored private var camera: MWDATCamera.Camera?
  @ObservationIgnored private let decoder = VideoFrameDecoder()
  @ObservationIgnored private let hfp = AudioInputHandler()
  @ObservationIgnored private var hfpRunning = false
  @ObservationIgnored private var stopping = false
  @ObservationIgnored private var lastSessionError: String?
  @ObservationIgnored private var deviceMonitorTask: Task<Void, Never>?
  @ObservationIgnored private let sessionTokens = ListenerTokenBag()
  @ObservationIgnored private let streamTokens = ListenerTokenBag()
  @ObservationIgnored private let audioTokens = ListenerTokenBag()

  /// 24 fps / low / hvc1 is the configuration verified on Ray-Ban Meta Gen 2 over Bluetooth Classic.
  static let frameRate: UInt = 24

  init(wearables: WearablesInterface) {
    self.wearables = wearables
    self.deviceSelector = AutoDeviceSelector(wearables: wearables)
    deviceMonitorTask = Task { [weak self] in
      guard let self else { return }
      for await deviceId in deviceSelector.activeDeviceStream() {
        hasActiveDevice = deviceId != nil
      }
    }
  }

  isolated deinit {
    deviceMonitorTask?.cancel()
    deviceSession?.stop()
  }

  var isRunning: Bool { deviceSession != nil }

  /// Session -> permissions -> mic path -> camera stream. Throws with a technician-readable reason.
  func start(micPath: GlassesMicPath) async throws {
    guard deviceSession == nil else { return }
    stopping = false
    lastSessionError = nil
    self.micPath = micPath
    releaseAppAudio(reason: "before session start")
    if StreamDiagnostics.isHfpInputActive() {
      log("audio", "WARNING HFP input still in the route before createSession; another app may hold it")
    }

    let session: DeviceSession
    do {
      session = try wearables.createSession(deviceSelector: deviceSelector)
    } catch {
      throw FlareBackend.Failure(message: "Could not create a glasses session: \(error.localizedDescription)")
    }
    deviceSession = session
    observe(session)
    sessionState = .starting
    log("session", "session.start() for \(micPath.rawValue)")
    do {
      try session.start()
    } catch {
      cleanup(reason: "session start threw")
      throw FlareBackend.Failure(message: "Glasses session failed to start: \(error.localizedDescription)")
    }

    guard await waitUntil(seconds: 20, { [weak self] in self?.sessionState == .started || self?.deviceSession == nil }),
      sessionState == .started
    else {
      let reason = lastSessionError ?? "the glasses did not start a session in 20 s. Are they on, unfolded and connected in Meta AI?"
      await stop(reason: "session did not start")
      throw FlareBackend.Failure(message: reason)
    }

    guard await ensurePermission(.camera) else {
      await stop(reason: "camera permission")
      throw FlareBackend.Failure(message: "Camera permission for the glasses was not granted in Meta AI.")
    }

    switch micPath {
    case .datPcm:
      guard await ensurePermission(.microphone) else {
        await stop(reason: "mic permission")
        throw FlareBackend.Failure(message: "VIDEO_PCM needs the glasses microphone permission in Meta AI.")
      }
    case .hfp:
      try await startHfp()
      guard sessionState == .started, deviceSession === session else {
        await stop(reason: "session ended at HFP-up")
        throw FlareBackend.Failure(
          message: "The glasses ended the session when Bluetooth HFP opened. This is the known firmware behaviour (DAT #342); use DAT PCM.")
      }
    case .videoOnly:
      break
    }

    try beginStream(on: session, micPath: micPath)
  }

  /// Releases the PCM listener, camera, session and HFP, then hands the audio session back.
  func stop(reason: String) async {
    guard deviceSession != nil || camera != nil || hfpRunning else { return }
    stopping = true
    log("session", "stop (\(reason))")
    await audioTokens.cancelAll()
    camera?.stop()
    deviceSession?.stop()
    cleanup(reason: reason)
  }

  // MARK: - Steps

  private func ensurePermission(_ permission: Permission) async -> Bool {
    do {
      var status = try await wearables.checkPermissionStatus(permission)
      log("permission", "\(permission) status=\(status)")
      if status != .granted {
        status = try await wearables.requestPermission(permission)
        log("permission", "requestPermission(\(permission)) -> \(status)")
      }
      return status == .granted
    } catch {
      log("permission", "\(permission) threw \(error)")
      return false
    }
  }

  private func startHfp() async throws {
    let granted = await withCheckedContinuation { c in AVAudioApplication.requestRecordPermission { c.resume(returning: $0) } }
    guard granted else { throw FlareBackend.Failure(message: "iOS microphone permission is required for the glasses' HFP microphone.") }
    let forward = onMicSamples
    hfp.setCallbacks(
      onAudioBuffer: { samples, _, format in forward?(samples, format.mSampleRate) },
      onInterruptionResume: {},
      onGlassesAudioUnavailable: { [weak self] in
        Task { @MainActor in
          self?.hfpRouteUp = false
          self?.log("audio", "glasses HFP input not active; nothing is captured (phone mic is never used)")
        }
      }
    )
    hfp.setup()
    hfp.setupInput()
    hfp.startListening()
    hfpRunning = true
    let up = await waitUntil(seconds: 3) { StreamDiagnostics.isHfpInputActive() }
    hfpRouteUp = up
    log("audio", "HFP route \(up ? "up" : "NOT up after 3 s"): \(StreamDiagnostics.audioRouteSummary())")
    guard up else {
      throw FlareBackend.Failure(message: "The glasses' Bluetooth HFP microphone is not the active input. Select the glasses in Control Center and retry.")
    }
  }

  private func beginStream(on session: DeviceSession, micPath: GlassesMicPath) throws {
    let config: StreamConfiguration =
      micPath == .datPcm
      ? StreamConfiguration(
        videoCodec: .hvc1, audioCodec: .pcm(sampleRate: .rate16000, numberOfChannels: 1), resolution: .low, frameRate: Self.frameRate)
      : StreamConfiguration(videoCodec: .hvc1, resolution: .low, frameRate: Self.frameRate)
    guard let newCamera = try session.addCamera(config: config) else {
      throw FlareBackend.Failure(message: "The glasses did not create a camera. Try again.")
    }
    camera = newCamera
    let stream = newCamera.stream
    stream.statePublisher.listen { [weak self] state in
      Task { @MainActor in self?.handleStreamState(state) }
    }.store(in: streamTokens)
    stream.errorPublisher.listen { [weak self] error in
      Task { @MainActor in self?.handleStreamError(error) }
    }.store(in: streamTokens)

    let decoder = self.decoder
    let onFrame = onVideoFrame
    stream.videoFramePublisher.listen { frame in
      // HEVC frames depend on their predecessors, so every frame is decoded; sampling happens downstream.
      if let image = decoder.decode(frame.sampleBuffer) { onFrame?(image) }
    }.store(in: streamTokens)

    if micPath == .datPcm {
      let onMic = onMicSamples
      stream.audioFramePublisher.listen { frame in
        let buffer = frame.pcmBuffer
        let n = Int(buffer.frameLength)
        guard n > 0 else { return }
        let rate = buffer.format.sampleRate
        if let ch = buffer.floatChannelData?[0] {
          onMic?(Array(UnsafeBufferPointer(start: ch, count: n)), rate)
        } else if let ch = buffer.int16ChannelData?[0] {
          onMic?(UnsafeBufferPointer(start: ch, count: n).map { Float($0) / 32768 }, rate)
        }
      }.store(in: audioTokens)
    }
    streamState = .starting
    log("stream", "stream.start() hvc1 low @\(Self.frameRate)fps mic=\(micPath.rawValue)")
    stream.start()
  }

  // MARK: - Observation

  private func observe(_ session: DeviceSession) {
    session.statePublisher.listen { [weak self] state in
      Task { @MainActor in self?.handleSessionState(state) }
    }.store(in: sessionTokens)
    session.errorPublisher.listen { [weak self] error in
      Task { @MainActor in
        self?.lastSessionError = error.localizedDescription
        self?.log("session", "error \(error)")
      }
    }.store(in: sessionTokens)
  }

  private func handleSessionState(_ state: DeviceSessionState) {
    log("session", "state -> \(state.description)")
    // Late events from a session already torn down would leave a stale label.
    guard deviceSession != nil else { return }
    sessionState = state
    if state == .stopped {
      let unexpected = !stopping
      cleanup(reason: "session stopped")
      if unexpected { onEnded?(lastSessionError.map { "The glasses ended the session: \($0)" } ?? "The glasses ended the session.") }
    }
  }

  private func handleStreamState(_ state: StreamState) {
    log("stream", "state -> \(state)")
    guard camera != nil else { return }
    streamState = state
    if state == .stopped, !stopping, deviceSession != nil {
      onEnded?("The glasses camera stream stopped.")
    }
  }

  private func handleStreamError(_ error: StreamError) {
    log("stream", "STREAM ERROR \(error)")
    guard !stopping else { return }
    let hint: String
    switch error {
    case .audioStreamingError: hint = " In-stream PCM is beta-channel only; switch to HFP or check the Meta release channel."
    case .deviceNotConnected: hint = " The stream link never came up (Bluetooth Classic)."
    case .hingesClosed: hint = " Unfold the glasses."
    case .thermalHot, .batteryLow, .peakPowerLimit: hint = " The glasses limited the camera."
    default: hint = ""
    }
    onEnded?("Glasses stream error: \(error.localizedDescription).\(hint)")
  }

  private func cleanup(reason: String) {
    sessionTokens.clear()
    streamTokens.clear()
    audioTokens.clear()
    camera = nil
    deviceSession = nil
    streamState = .stopped
    if sessionState != .stopped { sessionState = .idle }
    releaseAppAudio(reason: reason)
  }

  /// Same release as the POC: HFP engine and observers stopped, session deactivated, category reset.
  private func releaseAppAudio(reason: String) {
    if hfpRunning {
      hfp.stopListening()
      hfpRunning = false
    }
    hfp.cleanup()
    hfpRouteUp = false
    let audioSession = AVAudioSession.sharedInstance()
    try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
    try? audioSession.setCategory(.soloAmbient, mode: .default, options: [])
    log("audio", "released (\(reason)): \(StreamDiagnostics.audioRouteSummary())")
  }

  private func waitUntil(seconds: Double, _ condition: @MainActor () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + .milliseconds(Int(seconds * 1000))
    while ContinuousClock.now < deadline {
      if condition() { return true }
      try? await Task.sleep(for: .milliseconds(100))
    }
    return condition()
  }

  private func log(_ category: String, _ message: String) {
    StreamDiagnosticsLog.shared.log("flare.\(category)", message)
  }
}
