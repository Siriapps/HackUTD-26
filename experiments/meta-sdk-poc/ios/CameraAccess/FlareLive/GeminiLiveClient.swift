/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Minimal Gemini Live client over URLSessionWebSocketTask, speaking the same wire protocol
 * `@google/genai` uses in the browser: a `setup` frame (built by the server, see
 * src/app/api/gemini/glasses), then `realtimeInput` audio/video, `toolResponse`, and
 * `serverContent` / `toolCall` / `goAway` back. Authenticates with a single-use ephemeral
 * token; the API key never reaches the phone.
 */

import Foundation
import os

final class GeminiLiveClient: NSObject, Sendable, URLSessionWebSocketDelegate {
  struct ToolCall: Sendable, Equatable {
    let id: String?
    let name: String
    let args: [String: String]
  }

  enum Event: Sendable {
    case opened
    case setupComplete
    case audio(Data)
    case inputTranscript(String)
    case outputTranscript(String)
    case interrupted
    case turnComplete
    case toolCalls([ToolCall])
    case goAway(String?)
    case closed(code: Int, reason: String)
    case failure(String)
  }

  enum Lane { case audio, video, control }

  struct Counters: Sendable {
    var audioChunksSent = 0
    var audioChunksDropped = 0
    var framesSent = 0
    var framesDropped = 0
    var bytesSent = 0
    var outstandingBytes = 0
    var videoInFlight = false
  }

  /// Drop audio once this much is queued unsent (~10 s of 16 kHz PCM as base64 JSON).
  static let audioBacklogLimit = 450_000
  /// Drop a frame while one is still in flight or this much is queued.
  static let videoBacklogLimit = 150_000

  let events: AsyncStream<Event>
  private let continuation: AsyncStream<Event>.Continuation

  private struct State {
    var session: URLSession?
    var task: URLSessionWebSocketTask?
    var counters = Counters()
    var finished = false
  }
  private let state = OSAllocatedUnfairLock(uncheckedState: State())

  override init() {
    (events, continuation) = AsyncStream.makeStream(of: Event.self, bufferingPolicy: .unbounded)
    super.init()
  }

  var counters: Counters { state.withLockUnchecked { $0.counters } }

  /// Opens the socket and sends `setupJSON` (the server-built `setup` object) as `{"setup": …}`.
  func connect(url: URL, setupJSON: Data) {
    let config = URLSessionConfiguration.default
    config.waitsForConnectivity = false
    let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    let task = session.webSocketTask(with: url)
    task.maximumMessageSize = 16 * 1024 * 1024
    state.withLockUnchecked {
      $0.session = session
      $0.task = task
    }
    task.resume()
    var frame = Data(#"{"setup":"#.utf8)
    frame.append(setupJSON)
    frame.append(Data("}".utf8))
    send(frame, lane: .control)
    receiveNext(task)
  }

  func sendAudio(pcm16: Data, sampleRate: Int) {
    let message: [String: Any] = [
      "realtimeInput": ["audio": ["data": pcm16.base64EncodedString(), "mimeType": "audio/pcm;rate=\(sampleRate)"]]
    ]
    guard let json = try? JSONSerialization.data(withJSONObject: message) else { return }
    send(json, lane: .audio)
  }

  /// Returns false when the frame was dropped for backpressure.
  @discardableResult
  func sendVideo(jpeg: Data) -> Bool {
    let message: [String: Any] = ["realtimeInput": ["video": ["data": jpeg.base64EncodedString(), "mimeType": "image/jpeg"]]]
    guard let json = try? JSONSerialization.data(withJSONObject: message) else { return false }
    return send(json, lane: .video)
  }

  func sendText(_ text: String) {
    guard let json = try? JSONSerialization.data(withJSONObject: ["realtimeInput": ["text": text]]) else { return }
    send(json, lane: .control)
  }

  /// `responses`: [{ id, name, response: {...}, scheduling: "WHEN_IDLE" | "INTERRUPT" }]
  func sendToolResponses(_ responses: [[String: Any]]) {
    guard let json = try? JSONSerialization.data(withJSONObject: ["toolResponse": ["functionResponses": responses]]) else { return }
    send(json, lane: .control)
  }

  func close() {
    let (task, session) = state.withLockUnchecked { s -> (URLSessionWebSocketTask?, URLSession?) in
      let out = (s.task, s.session)
      s.task = nil
      s.session = nil
      return out
    }
    task?.cancel(with: .normalClosure, reason: nil)
    session?.invalidateAndCancel()
    finish(.closed(code: URLSessionWebSocketTask.CloseCode.normalClosure.rawValue, reason: "closed by app"))
  }

  // MARK: - Sending

  @discardableResult
  private func send(_ json: Data, lane: Lane) -> Bool {
    let size = json.count
    let task: URLSessionWebSocketTask? = state.withLockUnchecked { s in
      guard let task = s.task, !s.finished else { return nil }
      switch lane {
      case .audio:
        if s.counters.outstandingBytes > Self.audioBacklogLimit {
          s.counters.audioChunksDropped += 1
          return nil
        }
        s.counters.audioChunksSent += 1
      case .video:
        if s.counters.videoInFlight || s.counters.outstandingBytes > Self.videoBacklogLimit {
          s.counters.framesDropped += 1
          return nil
        }
        s.counters.videoInFlight = true
      case .control:
        break
      }
      s.counters.outstandingBytes += size
      return task
    }
    guard let task else { return false }
    // Text frames: the Live API accepts JSON as text, and the SDK sends text.
    task.send(.string(String(decoding: json, as: UTF8.self))) { [weak self] error in
      guard let self else { return }
      self.state.withLockUnchecked { s in
        s.counters.outstandingBytes -= size
        if lane == .video {
          s.counters.videoInFlight = false
          if error == nil { s.counters.framesSent += 1 }
        }
        if error == nil { s.counters.bytesSent += size }
      }
      if let error, lane == .control {
        self.continuation.yield(.failure("send failed: \(error.localizedDescription)"))
      }
    }
    return true
  }

  // MARK: - Receiving

  private func receiveNext(_ task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let message):
        let data: Data
        switch message {
        case .data(let d): data = d
        case .string(let s): data = Data(s.utf8)
        @unknown default: data = Data()
        }
        for event in Self.parse(data) { self.continuation.yield(event) }
        self.receiveNext(task)
      case .failure(let error):
        // The close delegate reports the code and reason when the server closed cleanly.
        let closeReason = task.closeReason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        if task.closeCode != .invalid {
          self.finish(.closed(code: task.closeCode.rawValue, reason: closeReason))
        } else {
          self.finish(.failure(error.localizedDescription))
        }
      }
    }
  }

  private func finish(_ event: Event) {
    let first = state.withLockUnchecked { s -> Bool in
      guard !s.finished else { return false }
      s.finished = true
      return true
    }
    guard first else { return }
    continuation.yield(event)
    continuation.finish()
  }

  /// Decodes one server message into events, in the order the web client handles them.
  static func parse(_ data: Data) -> [Event] {
    guard let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
    var out: [Event] = []
    if msg["setupComplete"] != nil { out.append(.setupComplete) }
    if let sc = msg["serverContent"] as? [String: Any] {
      if sc["interrupted"] as? Bool == true { out.append(.interrupted) }
      if let t = (sc["inputTranscription"] as? [String: Any])?["text"] as? String, !t.isEmpty { out.append(.inputTranscript(t)) }
      if let t = (sc["outputTranscription"] as? [String: Any])?["text"] as? String, !t.isEmpty { out.append(.outputTranscript(t)) }
      let parts = (sc["modelTurn"] as? [String: Any])?["parts"] as? [[String: Any]] ?? []
      for part in parts {
        if let b64 = (part["inlineData"] as? [String: Any])?["data"] as? String, let audio = Data(base64Encoded: b64) {
          out.append(.audio(audio))
        }
      }
      if sc["turnComplete"] as? Bool == true { out.append(.turnComplete) }
    }
    if let calls = (msg["toolCall"] as? [String: Any])?["functionCalls"] as? [[String: Any]], !calls.isEmpty {
      out.append(
        .toolCalls(
          calls.map { c in
            let args = (c["args"] as? [String: Any] ?? [:]).compactMapValues { argString($0) }
            return ToolCall(id: c["id"] as? String, name: c["name"] as? String ?? "", args: args)
          }))
    }
    if let goAway = msg["goAway"] as? [String: Any] { out.append(.goAway(goAway["timeLeft"] as? String)) }
    return out
  }

  /// Tool args as strings without losing meaning: JSON booleans become "true"/"false" (an NSNumber's
  /// description would be "1"/"0"), numbers keep their digits, arrays/objects become JSON text.
  static func argString(_ v: Any) -> String? {
    if let s = v as? String { return s }
    if v is NSNull { return nil }
    if let n = v as? NSNumber {
      if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
      return n.stringValue
    }
    if JSONSerialization.isValidJSONObject(v), let d = try? JSONSerialization.data(withJSONObject: v), let s = String(data: d, encoding: .utf8) {
      return s
    }
    return nil
  }

  // MARK: - URLSessionWebSocketDelegate

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
    continuation.yield(.opened)
  }

  func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
  ) {
    finish(.closed(code: closeCode.rawValue, reason: reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""))
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error { finish(.failure(error.localizedDescription)) }
  }
}
