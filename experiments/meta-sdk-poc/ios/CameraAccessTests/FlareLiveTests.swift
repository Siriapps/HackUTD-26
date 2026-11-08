@testable import CameraAccess
import UIKit
import XCTest

final class FlareLiveTests: XCTestCase {
  // MARK: - Echo gate

  private let chunk = Data(count: 1280)

  func testGatePassesEverythingWhileGeminiIsSilent() {
    var gate = EchoGate()
    XCTAssertEqual(gate.decide(chunk: chunk, rms: 0.5, assistantAudible: false), .send([chunk]))
    XCTAssertEqual(gate.decide(chunk: chunk, rms: 0, assistantAudible: false), .send([chunk]))
  }

  func testGateMutesEchoWhileGeminiSpeaks() {
    var gate = EchoGate()
    XCTAssertEqual(gate.decide(chunk: chunk, rms: 0.02, assistantAudible: true), .mute)
    XCTAssertEqual(gate.decide(chunk: chunk, rms: 0.07, assistantAudible: true), .mute)
    XCTAssertEqual(gate.decide(chunk: chunk, rms: 0.01, assistantAudible: true), .mute, "a quiet chunk resets the loud run")
    XCTAssertEqual(gate.decide(chunk: chunk, rms: 0.07, assistantAudible: true), .mute)
  }

  func testSustainedSpeechBargesInAndReleasesHeldChunks() {
    var gate = EchoGate()
    let a = Data([1, 0]), b = Data([2, 0]), c = Data([3, 0])
    XCTAssertEqual(gate.decide(chunk: a, rms: 0.2, assistantAudible: true), .mute)
    XCTAssertEqual(gate.decide(chunk: b, rms: 0.2, assistantAudible: true), .mute)
    XCTAssertEqual(gate.decide(chunk: c, rms: 0.2, assistantAudible: true), .bargeIn([a, b, c]))
    XCTAssertEqual(gate.decide(chunk: a, rms: 0.0, assistantAudible: true), .send([a]), "stays open for the rest of the turn")
  }

  func testHalfDuplexWhenBargeInIsOff() {
    var gate = EchoGate()
    gate.allowBargeIn = false
    for _ in 0..<10 { XCTAssertEqual(gate.decide(chunk: chunk, rms: 0.9, assistantAudible: true), .mute) }
  }

  // MARK: - Frame sampler

  func testScaledSizeKeepsAspectAndNeverUpscales() {
    XCTAssertTrue(FrameSampler.scaledSize(width: 1280, height: 720, maxEdge: 768) == (768, 432))
    XCTAssertTrue(FrameSampler.scaledSize(width: 720, height: 1280, maxEdge: 768) == (432, 768))
    XCTAssertTrue(FrameSampler.scaledSize(width: 360, height: 640, maxEdge: 768) == (360, 640))
  }

  func testSamplerHandsOutOnlyTheNewestFreshFrameOnce() {
    let sampler = FrameSampler()
    let t0 = Date()
    sampler.offer(Self.image(width: 8, height: 8), at: t0)
    let newest = Self.image(width: 16, height: 8)
    sampler.offer(newest, at: t0)
    XCTAssertTrue(sampler.takeFresh(now: t0) === newest)
    XCTAssertNil(sampler.takeFresh(now: t0), "the same frame is never sent twice")
    sampler.offer(Self.image(width: 8, height: 8), at: t0)
    XCTAssertNil(sampler.takeFresh(now: t0.addingTimeInterval(5)), "stale frames from a stalled stream are dropped")
  }

  func testJpegIsDownscaledWithAspectRatio() throws {
    let sampler = FrameSampler(settings: .init(maxEdge: 320, jpegQuality: 0.6, maxAge: 2))
    let jpeg = try XCTUnwrap(sampler.jpeg(Self.image(width: 640, height: 360)))
    let decoded = try XCTUnwrap(UIImage(data: jpeg)?.cgImage)
    XCTAssertEqual(decoded.width, 320)
    XCTAssertEqual(decoded.height, 180)
  }

  // MARK: - PCM16 conversion

  func testSixteenKilohertzInputIsChunkedWithoutResampling() {
    let converter = PCM16Converter(outputRate: 16000, chunkMilliseconds: 40)
    XCTAssertEqual(converter.push(Array(repeating: 0.5, count: 600), sampleRate: 16000).count, 0)
    let chunks = converter.push(Array(repeating: 0.5, count: 700), sampleRate: 16000)
    XCTAssertEqual(chunks.count, 2)
    XCTAssertEqual(chunks[0].count, 640 * 2)
    XCTAssertEqual(PCM16Converter.rms(pcm16: chunks[0]), 0.5, accuracy: 0.001)
  }

  func testResamplesOtherRatesToSixteenKilohertz() {
    let converter = PCM16Converter(outputRate: 16000, chunkMilliseconds: 40)
    let tone = (0..<48000).map { Float(sin(Double($0) * 2 * .pi * 440 / 48000) * 0.5) }
    var samples = 0
    for start in stride(from: 0, to: tone.count, by: 1024) {
      samples += converter.push(Array(tone[start..<min(start + 1024, tone.count)]), sampleRate: 48000).reduce(0) { $0 + $1.count / 2 }
    }
    XCTAssertEqual(Double(samples), 16000, accuracy: 700, "one second in, about one second out")
  }

  func testInt16Clamps() {
    let data = PCM16Converter.int16([2, -2, 0])
    let values = data.withUnsafeBytes { Array($0.bindMemory(to: Int16.self)) }
    XCTAssertEqual(values, [32767, -32768, 0])
  }

  // MARK: - Server messages

  func testParsesServerContentInWebClientOrder() {
    let msg = #"""
      {"serverContent":{"interrupted":true,"inputTranscription":{"text":"what is"},"outputTranscription":{"text":"A flange"},
      "modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AAEC"}}]},"turnComplete":true}}
      """#
    let events = GeminiLiveClient.parse(Data(msg.utf8))
    XCTAssertEqual(events.count, 5)
    guard case .interrupted = events[0], case .inputTranscript("what is") = events[1], case .outputTranscript("A flange") = events[2],
      case .audio(let audio) = events[3], case .turnComplete = events[4]
    else { return XCTFail("unexpected \(events)") }
    XCTAssertEqual(audio, Data([0, 1, 2]))
  }

  func testParsesToolCallsSetupAndGoAway() {
    let tools = GeminiLiveClient.parse(Data(#"{"toolCall":{"functionCalls":[{"id":"c1","name":"log_observation","args":{"text":"wet flange"}}]}}"#.utf8))
    guard case .toolCalls(let calls) = tools.first else { return XCTFail("no tool call") }
    XCTAssertEqual(calls, [GeminiLiveClient.ToolCall(id: "c1", name: "log_observation", args: ["text": "wet flange"])])
    guard case .setupComplete = GeminiLiveClient.parse(Data(#"{"setupComplete":{}}"#.utf8)).first else { return XCTFail("no setup") }
    guard case .goAway("10s") = GeminiLiveClient.parse(Data(#"{"goAway":{"timeLeft":"10s"}}"#.utf8)).first else { return XCTFail("no goAway") }
  }

  /// Regression: JSON `true` used to arrive as "1" (NSNumber description), so technician_confirmed was never true
  /// and every `completed` / submit was refused. Arrays used to be stringified garbage.
  @MainActor
  func testToolArgsKeepBooleansNumbersAndLists() {
    let msg = #"{"toolCall":{"functionCalls":[{"id":"c2","name":"update_runbook_step","args":{"step_index":2,"status":"completed","technician_confirmed":true,"observations":["a","b"]}}]}}"#
    guard case .toolCalls(let calls) = GeminiLiveClient.parse(Data(msg.utf8)).first, let call = calls.first else { return XCTFail("no tool call") }
    XCTAssertEqual(call.args["technician_confirmed"], "true")
    XCTAssertEqual(call.args["step_index"], "2")
    XCTAssertEqual(call.args["status"], "completed")
    XCTAssertEqual(FlareLiveController.list(call.args["observations"] ?? ""), ["a", "b"])
    XCTAssertEqual(FlareLiveController.list("one\ntwo"), ["one", "two"])
  }

  // MARK: - Live Incident Response event envelope

  func testLiveEventEnvelopeHasRequiredFields() throws {
    // Simulate what FlareLiveController.publishLive assembles.
    let sessionId = "sess-abc-123"
    let folder = "full_week"
    let eventId = "EV-0001"
    let seq = 5
    let atMs = Int64(Date().timeIntervalSince1970 * 1000)

    let event: [String: Any] = [
      "id": UUID().uuidString,
      "seq": seq,
      "sessionId": sessionId,
      "folder": folder,
      "eventId": eventId,
      "at": atMs,
      "type": "transcript.final",
      "payload": [
        "role": "tech",
        "text": "I see a wet flange",
        "turnId": UUID().uuidString
      ]
    ]

    let data = try JSONSerialization.data(withJSONObject: event)
    let parsed = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

    XCTAssertEqual(parsed["sessionId"] as? String, sessionId)
    XCTAssertEqual(parsed["eventId"] as? String, eventId)
    XCTAssertEqual(parsed["folder"] as? String, folder)
    XCTAssertEqual(parsed["seq"] as? Int, seq)
    XCTAssertEqual(parsed["type"] as? String, "transcript.final")
    XCTAssertNotNil(parsed["id"] as? String)
    XCTAssertNotNil(parsed["at"] as? Int64)
    let payload = try XCTUnwrap(parsed["payload"] as? [String: Any])
    XCTAssertEqual(payload["role"] as? String, "tech")
  }

  func testRunbookUpdateEnvelopeHasTechnicianConfirmed() throws {
    let event: [String: Any] = [
      "id": UUID().uuidString,
      "seq": 3,
      "sessionId": "sess-1",
      "folder": "full_week",
      "eventId": "EV-0003",
      "at": Int64(Date().timeIntervalSince1970 * 1000),
      "type": "runbook.update",
      "payload": [
        "stepIndex": 0,
        "status": "completed",
        "technicianConfirmed": true,
        "observation": "Breaker was tripped; reset performed"
      ]
    ]
    let data = try JSONSerialization.data(withJSONObject: event)
    let parsed = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(parsed["type"] as? String, "runbook.update")
    let payload = try XCTUnwrap(parsed["payload"] as? [String: Any])
    XCTAssertEqual(payload["technicianConfirmed"] as? Bool, true)
    XCTAssertEqual(payload["stepIndex"] as? Int, 0)
  }

  private static func image(width: Int, height: Int) -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: {
      let f = UIGraphicsImageRendererFormat()
      f.scale = 1
      return f
    }()).image { ctx in
      UIColor.orange.setFill()
      ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
    }
  }
}
