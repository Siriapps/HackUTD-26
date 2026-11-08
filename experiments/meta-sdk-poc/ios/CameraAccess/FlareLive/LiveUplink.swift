/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Thread-safe bridge from the capture callbacks (DAT / HFP threads) to the current Gemini
 * socket: mic samples -> 16 kHz PCM16 chunks -> echo gate -> realtimeInput audio, and
 * decoded frames -> latest-frame slot (sampled to Gemini by the frame pump).
 */

import Foundation
import UIKit
import os

final class LiveUplink: Sendable {
  struct Snapshot: Sendable {
    var framesFromSource = 0
    var lastFrameAt: Date?
    var micLevel: Float = 0
    var micBuffers = 0
    var micMuted = false
    var bargeIns = 0
    var preview: UIImage?
    var previewSeq = 0
  }

  private struct State {
    var client: GeminiLiveClient?
    var gate = EchoGate()
    var paused = false
    var wantsPreview = true
    var lastPreviewAt: Date = .distantPast
    var snapshot = Snapshot()
    var onBargeIn: (@Sendable () -> Void)?
  }

  let sampler: FrameSampler
  let converter: PCM16Converter
  let player: LiveAudioPlayer
  private let state = OSAllocatedUnfairLock(uncheckedState: State())

  init(sampler: FrameSampler, converter: PCM16Converter, player: LiveAudioPlayer) {
    self.sampler = sampler
    self.converter = converter
    self.player = player
  }

  var snapshot: Snapshot { state.withLockUnchecked { $0.snapshot } }
  var client: GeminiLiveClient? { state.withLockUnchecked { $0.client } }

  func attach(_ client: GeminiLiveClient) {
    state.withLockUnchecked {
      $0.client = client
      $0.gate.reset()
    }
  }

  func detach() {
    state.withLockUnchecked {
      $0.client = nil
      $0.gate.reset()
    }
  }

  func configure(echoGuard: Bool, allowBargeIn: Bool, preview: Bool, onBargeIn: @escaping @Sendable () -> Void) {
    state.withLockUnchecked {
      $0.gate.enabled = echoGuard
      $0.gate.allowBargeIn = allowBargeIn
      $0.wantsPreview = preview
      $0.onBargeIn = onBargeIn
    }
  }

  func setPreview(_ on: Bool) {
    state.withLockUnchecked {
      $0.wantsPreview = on
      if !on { $0.snapshot.preview = nil }
    }
  }

  /// Interruptions (calls, Siri) pause the uplink; nothing is sent while paused.
  func setPaused(_ paused: Bool) {
    state.withLockUnchecked { $0.paused = paused }
  }

  func reset() {
    converter.reset()
    sampler.reset()
    state.withLockUnchecked {
      $0.client = nil
      $0.gate.reset()
      $0.paused = false
      $0.snapshot = Snapshot()
    }
  }

  // MARK: - From the media source

  func pushFrame(_ image: UIImage) {
    let now = Date()
    sampler.offer(image, at: now)
    state.withLockUnchecked { s in
      s.snapshot.framesFromSource += 1
      s.snapshot.lastFrameAt = now
      // The preview is for debugging; ~8 fps is plenty and keeps the main thread free.
      if s.wantsPreview, now.timeIntervalSince(s.lastPreviewAt) >= 0.125 {
        s.lastPreviewAt = now
        s.snapshot.preview = image
        s.snapshot.previewSeq += 1
      }
    }
  }

  func pushMic(_ samples: [Float], sampleRate: Double) {
    let level = StreamFeasibility.rmsLevel(samples)
    let rate = Int(converter.outputRate)
    let (client, paused) = state.withLockUnchecked { s -> (GeminiLiveClient?, Bool) in
      s.snapshot.micLevel = level
      s.snapshot.micBuffers += 1
      return (s.client, s.paused)
    }
    guard let client, !paused else { return }
    let audible = player.isAudible()
    for chunk in converter.push(samples, sampleRate: sampleRate) {
      let rms = PCM16Converter.rms(pcm16: chunk)
      let (decision, onBargeIn) = state.withLockUnchecked { s -> (EchoGate.Decision, (@Sendable () -> Void)?) in
        let d = s.gate.decide(chunk: chunk, rms: rms, assistantAudible: audible)
        s.snapshot.micMuted = d == .mute
        if case .bargeIn = d { s.snapshot.bargeIns += 1 }
        return (d, s.onBargeIn)
      }
      switch decision {
      case .send(let chunks):
        chunks.forEach { client.sendAudio(pcm16: $0, sampleRate: rate) }
      case .mute:
        client.sendAudio(pcm16: Data(count: chunk.count), sampleRate: rate)
      case .bargeIn(let chunks):
        player.flush()
        onBargeIn?()
        chunks.forEach { client.sendAudio(pcm16: $0, sampleRate: rate) }
      }
    }
  }
}
