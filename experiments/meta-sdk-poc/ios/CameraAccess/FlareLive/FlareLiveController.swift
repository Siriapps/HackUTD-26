/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * One hands-free Gemini Live call through the glasses:
 *   glasses session + camera stream (GlassesCapture)
 *   -> output audio route (A2DP for DAT PCM, the HFP link for HFP), verified, not assumed
 *   -> POST /api/gemini/glasses (event briefing, tools, single-use token)
 *   -> Gemini Live socket: mic chunks continuously, one JPEG per second, replies to the glasses
 *   -> tool calls answered like the web /field page (confirm / log / escalate / past incidents).
 * Ending the call releases the camera, the mic path, the socket and the audio session.
 */

import AVFoundation
import MWDATCamera
import MWDATCore
import Observation
import UIKit

@Observable
@MainActor
final class FlareLiveController {
  enum Phase: String {
    case idle = "Idle"
    case startingGlasses = "Starting glasses"
    case waitingForFrames = "Waiting for video"
    case requestingSession = "Requesting session"
    case connecting = "Connecting to Gemini"
    case live = "Live"
    case reconnecting = "Reconnecting"
    case ending = "Ending"
    case ended = "Ended"

    var isActive: Bool { self != .idle && self != .ended }
  }

  enum Role { case tech, gemini, system }

  struct Line: Identifiable, Equatable {
    let id: Int
    let role: Role
    var text: String
    var open: Bool
  }

  // MARK: - Settings (persisted)

  var serverURL: String { didSet { defaults.set(serverURL, forKey: "flare.serverURL") } }
  var deviceToken: String { didSet { defaults.set(deviceToken, forKey: "flare.deviceToken") } }
  var eventId: String { didSet { defaults.set(eventId, forKey: "flare.eventId") } }
  var folder: String { didSet { defaults.set(folder, forKey: "flare.folder") } }
  var micPath: GlassesMicPath { didSet { defaults.set(micPath.rawValue, forKey: "flare.micPath") } }
  var allowBargeIn: Bool {
    didSet {
      defaults.set(allowBargeIn, forKey: "flare.allowBargeIn")
      configureUplink()
    }
  }
  var showPreview: Bool {
    didSet {
      defaults.set(showPreview, forKey: "flare.showPreview")
      uplink.setPreview(showPreview)
      if !showPreview { previewImage = nil }
    }
  }

  // MARK: - Observable status

  private(set) var phase: Phase = .idle
  private(set) var lines: [Line] = []
  private(set) var errorMessage: String?
  private(set) var previewImage: UIImage?
  private(set) var model = ""
  private(set) var eventLabel = ""
  private(set) var glassesFrames = 0
  private(set) var glassesFps: Double = 0
  private(set) var framesSentToGemini = 0
  private(set) var framesDropped = 0
  private(set) var audioChunksSent = 0
  private(set) var audioChunksDropped = 0
  private(set) var micLevel: Float = 0
  private(set) var micBuffers = 0
  private(set) var micMuted = false
  private(set) var geminiSpeaking = false
  private(set) var outputRoute = "—"
  private(set) var outputOnGlasses = false
  private(set) var inputRoute = "—"
  private(set) var keyframes = 0

  let glasses: GlassesCapture

  // MARK: - Private

  @ObservationIgnored private let defaults = UserDefaults.standard
  @ObservationIgnored private let player = LiveAudioPlayer()
  @ObservationIgnored private let uplink: LiveUplink
  @ObservationIgnored private var backend: FlareBackend?
  @ObservationIgnored private var grant: FlareBackend.Grant?
  @ObservationIgnored private var client: GeminiLiveClient?
  @ObservationIgnored private var eventTask: Task<Void, Never>?
  @ObservationIgnored private var framePump: Task<Void, Never>?
  @ObservationIgnored private var refreshTask: Task<Void, Never>?
  @ObservationIgnored private var observers: [NSObjectProtocol] = []
  @ObservationIgnored private var reconnects = 0
  @ObservationIgnored private var lineId = 0
  @ObservationIgnored private var fpsWindow: (at: Date, frames: Int)?
  @ObservationIgnored private var lastPreviewSeq = 0
  @ObservationIgnored private var observationFrames: [Data] = []
  @ObservationIgnored private var statTicks = 0

  static let setupTimeout: Duration = .seconds(15)
  static let firstFrameTimeout: Duration = .seconds(20)
  static let maxReconnects = 3

  init(wearables: WearablesInterface) {
    serverURL = defaults.string(forKey: "flare.serverURL") ?? ""
    deviceToken = defaults.string(forKey: "flare.deviceToken") ?? ""
    eventId = defaults.string(forKey: "flare.eventId") ?? "FIX-LEAK"
    folder = defaults.string(forKey: "flare.folder") ?? ""
    micPath = GlassesMicPath(rawValue: defaults.string(forKey: "flare.micPath") ?? "") ?? .datPcm
    allowBargeIn = defaults.object(forKey: "flare.allowBargeIn") as? Bool ?? true
    showPreview = defaults.object(forKey: "flare.showPreview") as? Bool ?? true
    glasses = GlassesCapture(wearables: wearables)
    uplink = LiveUplink(sampler: FrameSampler(), converter: PCM16Converter(), player: player)
    configureUplink()
  }

  isolated deinit {
    eventTask?.cancel()
    framePump?.cancel()
    refreshTask?.cancel()
    client?.close()
    player.stop()
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    UIApplication.shared.isIdleTimerDisabled = false
  }

  // MARK: - Start

  func start() async {
    guard !phase.isActive else { return }
    errorMessage = nil
    lines = []
    reconnects = 0
    observationFrames = []
    keyframes = 0
    guard let backend = FlareBackend(server: serverURL, deviceToken: deviceToken) else {
      fail("Enter the Avon Night Shift server URL, e.g. http://your-mac.local:3000")
      return
    }
    guard !eventId.trimmingCharacters(in: .whitespaces).isEmpty else {
      fail("Enter an event ID (FIX-LEAK for the pipeline demo).")
      return
    }
    self.backend = backend
    UIApplication.shared.isIdleTimerDisabled = true
    installObservers()
    startRefresh()

    // 1. Glasses: session, permissions, mic path, camera stream.
    phase = .startingGlasses
    let uplink = self.uplink
    glasses.onVideoFrame = { image in uplink.pushFrame(image) }
    glasses.onMicSamples = { samples, rate in uplink.pushMic(samples, sampleRate: rate) }
    glasses.onEnded = { [weak self] reason in
      Task { await self?.end(reason) }
    }
    do {
      try await glasses.start(micPath: micPath)
    } catch {
      await abort(error.localizedDescription)
      return
    }
    inputRoute = micPath.inputDescription
    sys("Glasses session started (\(micPath.label)). Waiting for video…")

    // 2. Prove video is arriving before spending a Gemini session on it.
    phase = .waitingForFrames
    guard await waitUntil(Self.firstFrameTimeout, { uplink.snapshot.framesFromSource > 0 }) else {
      await abort("The glasses session started but no video frames arrived in 20 s. Fold and unfold the glasses, then try again.")
      return
    }
    guard phase == .waitingForFrames else { return }
    sys("Video frames arriving from the glasses.")

    // 3. Output route for Gemini's voice.
    do {
      try configureOutputAudio()
      try player.start()
    } catch {
      await abort("Could not start audio playback: \(error.localizedDescription)")
      return
    }
    refreshRoutes(announce: true)
    if glasses.sessionState != .started {
      await abort("The glasses ended the session when phone audio started (\(micPath.label)). Try the other mic path.")
      return
    }

    // 4. Session grant from the Night Shift server, then the Gemini socket.
    phase = .requestingSession
    do {
      let grant = try await backend.startSession(eventId: eventId.trimmingCharacters(in: .whitespaces), folder: folder.trimmingCharacters(in: .whitespaces))
      guard phase == .requestingSession else { return }
      self.grant = grant
      model = grant.model
      eventLabel = "\(grant.eventId) · \(grant.eventLabel)"
      try connect(grant)
    } catch {
      await abort("Could not start the Gemini session: \(error.localizedDescription)")
    }
  }

  private func connect(_ grant: FlareBackend.Grant) throws {
    guard let url = grant.socketURL else { throw FlareBackend.Failure(message: "bad wsUrl from the server") }
    phase = phase == .reconnecting ? .reconnecting : .connecting
    let client = GeminiLiveClient()
    self.client = client
    eventTask?.cancel()
    eventTask = Task { [weak self] in
      for await event in client.events {
        guard let self, self.client === client else { return }
        self.handle(event, from: client)
      }
    }
    client.connect(url: url, setupJSON: grant.setupJSON)
    Task { [weak self] in
      try? await Task.sleep(for: Self.setupTimeout)
      guard let self, self.client === client, self.phase == .connecting || self.phase == .reconnecting else { return }
      await self.end("Gemini did not accept the session setup within 15 s. Check GEMINI_LIVE_MODEL and the server log.")
    }
  }

  private func onSetupComplete(_ client: GeminiLiveClient) {
    let wasReconnect = phase == .reconnecting
    phase = .live
    uplink.attach(client)
    startFramePump(fps: grant?.videoFps ?? 1)
    if wasReconnect {
      sys("Reconnected to Gemini. The earlier conversation is not carried over; the briefing is.")
    } else {
      sys("Live with \(model) on \(eventLabel). Look at the equipment and ask out loud.")
    }
  }

  // MARK: - End

  /// Tears everything down. Safe to call more than once.
  func end(_ reason: String) async {
    guard phase.isActive, phase != .ending else { return }
    phase = .ending
    stopMedia()
    await glasses.stop(reason: "call ended")
    finishTeardown()
    phase = .ended
    sys(reason)
    sys(releaseReport())
  }

  private func abort(_ message: String) async {
    errorMessage = message
    phase = .ending
    stopMedia()
    await glasses.stop(reason: "start failed")
    finishTeardown()
    phase = .ended
    sys(message)
  }

  private func fail(_ message: String) {
    errorMessage = message
    sys(message)
  }

  private func stopMedia() {
    framePump?.cancel()
    framePump = nil
    eventTask?.cancel()
    eventTask = nil
    uplink.detach()
    client?.close()
    client = nil
    player.stop()
    geminiSpeaking = false
  }

  private func finishTeardown() {
    refreshTask?.cancel()
    refreshTask = nil
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    uplink.reset()
    observationFrames = []
    grant = nil
    previewImage = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    UIApplication.shared.isIdleTimerDisabled = false
    closeOpen(nil)
    refreshRoutes(announce: false)
  }

  private func releaseReport() -> String {
    let camera = glasses.isRunning ? "STILL RUNNING" : "released"
    let socket = client == nil ? "closed" : "STILL OPEN"
    return "Released: glasses session/camera \(camera), mic path \(micPath.label) stopped, Gemini socket \(socket), audio \(StreamDiagnostics.audioRouteSummary())."
  }

  // MARK: - Server events

  private func handle(_ event: GeminiLiveClient.Event, from client: GeminiLiveClient) {
    switch event {
    case .opened:
      break
    case .setupComplete:
      onSetupComplete(client)
    case .audio(let pcm):
      player.enqueue(pcm16: pcm)
    case .inputTranscript(let text):
      append(.tech, text)
    case .outputTranscript(let text):
      append(.gemini, text)
    case .interrupted:
      player.flush()
      closeOpen(.gemini)
    case .turnComplete:
      closeOpen(nil)
    case .toolCalls(let calls):
      Task { await handleTools(calls, client: client) }
    case .goAway(let timeLeft):
      sys("Gemini will close this connection in \(timeLeft ?? "a moment"); reconnecting.")
      Task { await reconnect() }
    case .closed(let code, let reason):
      guard [.live, .connecting, .reconnecting].contains(phase) else { return }
      Task { await end("Gemini closed the call (code \(code))\(reason.isEmpty ? "" : ": \(reason)").") }
    case .failure(let message):
      guard [.live, .connecting, .reconnecting].contains(phase) else { return }
      Task { await end("Connection to Gemini failed: \(message)") }
    }
  }

  private func reconnect() async {
    guard phase == .live, let backend, let grant else { return }
    guard reconnects < Self.maxReconnects else {
      await end("Gemini asked to reconnect \(Self.maxReconnects) times; ending. Tap Start Live again.")
      return
    }
    reconnects += 1
    phase = .reconnecting
    framePump?.cancel()
    uplink.detach()
    player.flush()
    let old = client
    do {
      let next = try await backend.startSession(eventId: grant.eventId, folder: grant.folder)
      guard phase == .reconnecting else { return }
      self.grant = next
      try connect(next)
      old?.close()
    } catch {
      old?.close()
      await end("Reconnect failed: \(error.localizedDescription)")
    }
  }

  // MARK: - Tools (same contract as src/components/LiveSession.tsx)

  private func handleTools(_ calls: [GeminiLiveClient.ToolCall], client: GeminiLiveClient) async {
    guard let grant, let backend else { return }
    var responses: [[String: Any]] = []
    for call in calls {
      var response: [String: Any]
      var scheduling = "WHEN_IDLE"
      switch call.name {
      case "confirm_plan":
        let note = call.args["note"]
        sys("Plan confirmed. Sending to ops…")
        Task { [weak self] in
          let r = await backend.notify(grant: grant, kind: "confirmation", note: note ?? "Confirmed on the glasses call")
          self?.sys(r.ok ? "Ops notified: \(r.message)" : "Ops not reached: \(r.message)")
        }
        response = ["result": "confirmed; ops notified"]
      case "log_observation":
        let text = call.args["text"] ?? ""
        if let frame = uplink.sampler.latest().flatMap({ uplink.sampler.jpeg($0) }) {
          observationFrames = Array((observationFrames + [frame]).suffix(8))
          keyframes = observationFrames.count
        }
        sys("Logged: \(text)")
        response = ["result": "logged with a keyframe"]
      case "escalate":
        let reason = call.args["reason"] ?? ""
        sys("Escalating to ops: \(reason)")
        let r = await backend.notify(grant: grant, kind: "escalation", note: reason)
        response = ["result": r.ok ? "ops notified: \(r.message)" : "dispatch unavailable (\(r.message)); logged locally"]
        scheduling = "INTERRUPT"
      case "get_past_incidents":
        response = ["incidents": grant.incidents.map { ["summary": $0.summary, "outcome": $0.outcome, "source": $0.source] }]
        scheduling = "INTERRUPT"
      default:
        response = ["error": "unknown tool \(call.name)"]
      }
      var fr: [String: Any] = ["name": call.name, "response": response, "scheduling": scheduling]
      if let id = call.id { fr["id"] = id }
      responses.append(fr)
    }
    guard self.client === client else { return }
    client.sendToolResponses(responses)
  }

  // MARK: - Debug

  /// Sends a typed question, to check the vision path without relying on the mic.
  func askTyped(_ text: String) {
    guard phase == .live, let client else { return }
    lineId += 1
    lines.append(Line(id: lineId, role: .tech, text: "(typed) \(text)", open: false))
    client.sendText(text)
  }

  // MARK: - Media plumbing

  private func configureUplink() {
    uplink.configure(echoGuard: true, allowBargeIn: allowBargeIn, preview: showPreview) { [weak self] in
      Task { @MainActor in self?.closeOpen(.gemini) }
    }
  }

  private func startFramePump(fps: Double) {
    framePump?.cancel()
    let uplink = self.uplink
    let interval = Duration.milliseconds(Int(1000 / max(0.2, min(fps, 2))))
    framePump = Task.detached(priority: .userInitiated) {
      while !Task.isCancelled {
        try? await Task.sleep(for: interval)
        guard let client = uplink.client, let image = uplink.sampler.takeFresh(), let jpeg = uplink.sampler.jpeg(image) else { continue }
        client.sendVideo(jpeg: jpeg)
      }
    }
  }

  /// DAT PCM / video only: no app mic at all, so `.playback` (A2DP to the glasses when they are the Bluetooth output).
  /// HFP: AudioInputHandler already holds `.playAndRecord` + `.allowBluetoothHFP`; replies use the same link.
  private func configureOutputAudio() throws {
    let session = AVAudioSession.sharedInstance()
    if micPath != .hfp {
      try session.setCategory(.playback, mode: .default, options: [])
    }
    try session.setActive(true)
  }

  private func refreshRoutes(announce: Bool) {
    let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
    let bluetooth: [AVAudioSession.Port] = [.bluetoothA2DP, .bluetoothHFP, .bluetoothLE]
    let bt = outputs.first { bluetooth.contains($0.portType) }
    let wasOnGlasses = outputOnGlasses
    outputOnGlasses = bt != nil
    if let bt {
      let named = bt.portName.localizedCaseInsensitiveContains("meta") || bt.portName.localizedCaseInsensitiveContains("ray-ban")
      outputRoute = "\(Self.portLabel(bt.portType))\(named ? " · Ray-Ban Meta" : " · other Bluetooth device")"
    } else {
      outputRoute = outputs.map { Self.portLabel($0.portType) }.joined(separator: ", ").ifEmpty("none")
    }
    if micPath == .hfp, phase.isActive {
      inputRoute = StreamDiagnostics.isHfpInputActive() ? "Glasses mic · Bluetooth HFP" : "HFP input lost; nothing is captured"
    }
    guard announce || (phase == .live && wasOnGlasses != outputOnGlasses) else { return }
    if outputOnGlasses {
      sys("Gemini audio → \(outputRoute).")
    } else {
      sys("Gemini audio is on \(outputRoute), not the glasses. Pick the glasses in Control Center → audio output.")
    }
  }

  private static func portLabel(_ port: AVAudioSession.Port) -> String {
    switch port {
    case .bluetoothA2DP: return "Bluetooth A2DP"
    case .bluetoothHFP: return "Bluetooth HFP"
    case .bluetoothLE: return "Bluetooth LE"
    case .builtInSpeaker: return "Phone speaker"
    case .builtInReceiver: return "Phone earpiece"
    case .headphones: return "Wired headphones"
    default: return port.rawValue
    }
  }

  private func installObservers() {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    observers = [
      center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
        Task { @MainActor in
          // While starting, DAT permission requests hop to Meta AI and back; that is not the technician leaving.
          guard let self, self.phase != .startingGlasses else { return }
          await self.end("Flare went to the background, so the call ended (the glasses camera stops in the background). Keep the app open; the screen won't auto-lock during a call.")
        }
      },
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] _ in
        Task { @MainActor in self?.refreshRoutes(announce: false) }
      },
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
        let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
        Task { @MainActor in self?.handleInterruption(raw.flatMap(AVAudioSession.InterruptionType.init(rawValue:))) }
      },
    ]
  }

  private func handleInterruption(_ type: AVAudioSession.InterruptionType?) {
    guard phase.isActive, let type else { return }
    switch type {
    case .began:
      uplink.setPaused(true)
      player.flush()
      sys("Audio interrupted (call or Siri). Mic paused.")
    case .ended:
      do {
        try configureOutputAudio()
        try player.start()
        uplink.setPaused(false)
        refreshRoutes(announce: true)
        sys("Audio resumed.")
      } catch {
        Task { await end("Audio could not resume after the interruption: \(error.localizedDescription)") }
      }
    @unknown default:
      break
    }
  }

  /// Pulls counters from the capture threads a few times a second instead of hopping to the main actor per frame.
  private func startRefresh() {
    refreshTask?.cancel()
    refreshTask = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        self.refreshCounters()
        try? await Task.sleep(for: .milliseconds(250))
      }
    }
  }

  private func refreshCounters() {
    let snap = uplink.snapshot
    glassesFrames = snap.framesFromSource
    micLevel = snap.micLevel
    micBuffers = snap.micBuffers
    micMuted = snap.micMuted
    if showPreview, snap.previewSeq != lastPreviewSeq {
      lastPreviewSeq = snap.previewSeq
      previewImage = snap.preview
    }
    let now = Date()
    if let w = fpsWindow {
      let dt = now.timeIntervalSince(w.at)
      if dt >= 1 {
        glassesFps = StreamFeasibility.framesPerSecond(frameCount: snap.framesFromSource - w.frames, elapsedSeconds: dt)
        fpsWindow = (now, snap.framesFromSource)
      }
    } else {
      fpsWindow = (now, snap.framesFromSource)
    }
    if let c = client?.counters {
      framesSentToGemini = c.framesSent
      framesDropped = c.framesDropped
      audioChunksSent = c.audioChunksSent
      audioChunksDropped = c.audioChunksDropped
    }
    geminiSpeaking = player.isSpeaking
    statTicks += 1
    if phase.isActive, statTicks % 20 == 0 {
      trace(
        "STATS phase=\(phase.rawValue) glassesFrames=\(glassesFrames) fps=\(String(format: "%.1f", glassesFps)) "
          + "toGemini=\(framesSentToGemini) dropped=\(framesDropped) micBuffers=\(micBuffers) "
          + "micLevel=\(String(format: "%.3f", micLevel)) audioChunks=\(audioChunksSent) audioDropped=\(audioChunksDropped) "
          + "out=\(outputRoute) speaking=\(geminiSpeaking)")
    }
  }

  private func waitUntil(_ timeout: Duration, _ condition: () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
      if condition() { return true }
      if !phase.isActive { return false }
      try? await Task.sleep(for: .milliseconds(150))
    }
    return condition()
  }

  // MARK: - Transcript

  private func sys(_ text: String) {
    lineId += 1
    lines.append(Line(id: lineId, role: .system, text: text, open: false))
    StreamDiagnosticsLog.shared.log("flare", text)
    trace("SYS \(text)")
  }

  /// Debug builds mirror the call to stdout so `devicectl device process launch --console` can follow a device run.
  private func trace(_ text: String) {
    #if DEBUG
    print("[flare] \(text)")
    #endif
  }

  private func append(_ role: Role, _ text: String) {
    if let i = lines.lastIndex(where: { $0.role == role }), lines[i].open {
      lines[i].text += text
      return
    }
    lineId += 1
    lines.append(Line(id: lineId, role: role, text: text, open: true))
  }

  private func closeOpen(_ role: Role?) {
    for i in lines.indices where lines[i].open && (role == nil || lines[i].role == role) {
      lines[i].open = false
      trace("\(lines[i].role == .tech ? "TECH" : "GEMINI") \(lines[i].text)")
    }
  }
}

extension String {
  fileprivate func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}
