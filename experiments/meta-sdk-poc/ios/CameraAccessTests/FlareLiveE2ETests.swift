@testable import CameraAccess
import UIKit
import XCTest

/// Live call against a running Night Shift server and the real Gemini Live API, using the app's own
/// FlareBackend, GeminiLiveClient, FrameSampler and PCM16Converter (no glasses: the frame and the
/// spoken question come from files). Skipped unless the runner sets, e.g.:
///   TEST_RUNNER_FLARE_E2E_SERVER=http://localhost:3000
///   TEST_RUNNER_FLARE_E2E_IMAGE=/abs/path/pipe.jpg
///   TEST_RUNNER_FLARE_E2E_WAV=/abs/path/question-16k-mono.wav   (optional; typed question otherwise)
final class FlareLiveE2ETests: XCTestCase {
  func testGlassesPipelineReachesGeminiAndGetsASpokenAnswer() async throws {
    let env = ProcessInfo.processInfo.environment
    guard let server = env["FLARE_E2E_SERVER"], let imagePath = env["FLARE_E2E_IMAGE"] else {
      throw XCTSkip("set TEST_RUNNER_FLARE_E2E_SERVER and TEST_RUNNER_FLARE_E2E_IMAGE to run")
    }
    let backend = try XCTUnwrap(FlareBackend(server: server, deviceToken: env["FLARE_E2E_TOKEN"] ?? ""))
    let grant = try await backend.startSession(eventId: env["FLARE_E2E_EVENT"] ?? "FIX-LEAK", folder: "")
    XCTAssertEqual(grant.inputSampleRate, 16000)

    let image = try XCTUnwrap(UIImage(contentsOfFile: imagePath))
    let sampler = FrameSampler(settings: .init(maxEdge: grant.videoMaxEdge, jpegQuality: grant.videoJpegQuality, maxAge: 2))
    let client = GeminiLiveClient()
    client.connect(url: try XCTUnwrap(grant.socketURL), setupJSON: grant.setupJSON)

    var setupDone = false, heard = "", said = "", audioBytes = 0, turns = 0
    let speech = try env["FLARE_E2E_WAV"].map { try Self.wavSamples(path: $0) }
    let converter = PCM16Converter()

    let feeder = Task.detached {
      // One frame a second for the whole call, as the frame pump does.
      while !Task.isCancelled {
        sampler.offer(image)
        if let frame = sampler.takeFresh(), let jpeg = sampler.jpeg(frame) { client.sendVideo(jpeg: jpeg) }
        try? await Task.sleep(for: .seconds(1))
      }
    }
    defer { feeder.cancel() }

    for await event in client.events {
      switch event {
      case .setupComplete:
        setupDone = true
        try await Task.sleep(for: .seconds(2))
        if let speech {
          // Real-time 40 ms chunks, then a second of silence so server VAD ends the turn.
          for start in stride(from: 0, to: speech.count, by: 640) {
            for chunk in converter.push(Array(speech[start..<min(start + 640, speech.count)]), sampleRate: 16000) {
              client.sendAudio(pcm16: chunk, sampleRate: 16000)
            }
            try await Task.sleep(for: .milliseconds(40))
          }
          for _ in 0..<40 {
            client.sendAudio(pcm16: Data(count: 1280), sampleRate: 16000)
            try await Task.sleep(for: .milliseconds(40))
          }
        } else {
          client.sendText("What am I looking at right now? One sentence.")
        }
      case .inputTranscript(let t): heard += t
      case .outputTranscript(let t): said += t
      case .audio(let d): audioBytes += d.count
      case .toolCalls(let calls):
        client.sendToolResponses(calls.map { ["id": $0.id ?? "", "name": $0.name, "response": ["result": "ok"], "scheduling": "WHEN_IDLE"] })
      case .turnComplete:
        turns += 1
        if audioBytes > 0 { client.close() }
      case .closed(let code, let reason):
        if audioBytes == 0 { XCTFail("closed before an answer: \(code) \(reason)") }
      case .failure(let message):
        XCTFail("socket failure: \(message)")
      default:
        break
      }
    }
    let counters = client.counters
    print("FLARE_E2E heard=\"\(heard)\" said=\"\(said)\" audio=\(audioBytes)B framesSent=\(counters.framesSent) dropped=\(counters.framesDropped) audioChunks=\(counters.audioChunksSent)")
    XCTAssertTrue(setupDone)
    XCTAssertGreaterThan(counters.framesSent, 0, "frames reached the Gemini socket")
    XCTAssertGreaterThan(audioBytes, 0, "Gemini answered with audio")
    XCTAssertFalse(said.isEmpty, "output transcription present")
    if speech != nil { XCTAssertFalse(heard.isEmpty, "Gemini transcribed the spoken question") }
  }

  /// 16-bit mono WAV -> Float samples.
  private static func wavSamples(path: String) throws -> [Float] {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    guard let range = data.range(of: Data("data".utf8)) else { throw XCTSkip("not a WAV: \(path)") }
    let start = range.upperBound + 4
    let body = Data(data[start...])
    return body.withUnsafeBytes { raw in
      (0..<raw.count / 2).map { Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: $0 * 2, as: Int16.self))) / 32768 }
    }
  }
}
