/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Plays Gemini Live's 24 kHz PCM16 replies on whatever output the shared AVAudioSession routes
 * to (the glasses over A2DP or HFP when they are selected). The caller owns the session category;
 * this class owns only its engine. `isAudible` feeds the echo gate.
 */

import AVFoundation
import Foundation
import os

final class LiveAudioPlayer: Sendable {
  let sampleRate: Double

  private struct State {
    var engine: AVAudioEngine?
    var node: AVAudioPlayerNode?
    var pending = 0
    var generation = 0
    var lastAudibleAt: Date = .distantPast
    var configObserver: NSObjectProtocol?
  }
  private let state = OSAllocatedUnfairLock(uncheckedState: State())
  private let format: AVAudioFormat

  init(sampleRate: Double = 24000) {
    self.sampleRate = sampleRate
    self.format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
  }

  func start() throws {
    stop()
    let engine = AVAudioEngine()
    let node = AVAudioPlayerNode()
    engine.attach(node)
    engine.connect(node, to: engine.mainMixerNode, format: format)
    engine.prepare()
    try engine.start()
    node.play()
    // A route change (glasses dropping, a call) stops the engine; bring it back on the new route.
    let observer = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
    ) { [weak self] _ in
      self?.restart()
    }
    state.withLockUnchecked {
      $0.engine = engine
      $0.node = node
      $0.pending = 0
      $0.configObserver = observer
    }
  }

  func enqueue(pcm16 data: Data) {
    let frames = data.count / 2
    guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else { return }
    buffer.frameLength = AVAudioFrameCount(frames)
    let out = buffer.floatChannelData![0]
    data.withUnsafeBytes { raw in
      for (i, v) in raw.bindMemory(to: Int16.self).enumerated() { out[i] = Float(Int16(littleEndian: v)) / 32768 }
    }
    let (node, generation) = state.withLockUnchecked { s -> (AVAudioPlayerNode?, Int) in
      guard s.node != nil else { return (nil, 0) }
      s.pending += 1
      s.lastAudibleAt = Date()
      return (s.node, s.generation)
    }
    guard let node else { return }
    node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.state.withLockUnchecked { s in
        guard s.generation == generation else { return }
        s.pending = max(0, s.pending - 1)
        s.lastAudibleAt = Date()
      }
    }
  }

  /// Drops everything queued (Gemini was interrupted, or the technician barged in).
  func flush() {
    let node = state.withLockUnchecked { s -> AVAudioPlayerNode? in
      s.generation += 1
      s.pending = 0
      s.lastAudibleAt = Date()
      return s.node
    }
    node?.stop()
    node?.play()
  }

  var isSpeaking: Bool { state.withLockUnchecked { $0.pending > 0 } }

  /// Speaking now, or stopped less than `hold` seconds ago (room/speaker tail).
  func isAudible(hold: TimeInterval = 0.35) -> Bool {
    state.withLockUnchecked { $0.pending > 0 || Date().timeIntervalSince($0.lastAudibleAt) < hold }
  }

  func stop() {
    let (engine, node, observer) = state.withLockUnchecked { s -> (AVAudioEngine?, AVAudioPlayerNode?, NSObjectProtocol?) in
      let out = (s.engine, s.node, s.configObserver)
      s.engine = nil
      s.node = nil
      s.configObserver = nil
      s.pending = 0
      s.generation += 1
      return out
    }
    if let observer { NotificationCenter.default.removeObserver(observer) }
    node?.stop()
    engine?.stop()
  }

  private func restart() {
    let (engine, node) = state.withLockUnchecked { s -> (AVAudioEngine?, AVAudioPlayerNode?) in
      s.generation += 1
      s.pending = 0
      return (s.engine, s.node)
    }
    guard let engine, let node else { return }
    engine.connect(node, to: engine.mainMixerNode, format: format)
    try? engine.start()
    node.play()
  }
}
