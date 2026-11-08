/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Mono Float32 at any rate -> 16-bit little-endian mono PCM at Gemini Live's input rate,
 * emitted in fixed-length chunks so every WebSocket frame carries the same duration.
 */

import AVFoundation
import Foundation
import os

final class PCM16Converter: Sendable {
  let outputRate: Double
  let chunkSamples: Int

  private struct State {
    var converter: AVAudioConverter?
    var inputRate: Double = 0
    var pending = Data()
  }

  private let state = OSAllocatedUnfairLock(uncheckedState: State())
  private let outputFormat: AVAudioFormat

  /// - Parameters:
  ///   - outputRate: Gemini Live expects 16 kHz input.
  ///   - chunkMilliseconds: duration of each emitted chunk.
  init(outputRate: Double = 16000, chunkMilliseconds: Int = 40) {
    self.outputRate = outputRate
    self.chunkSamples = Int(outputRate) * chunkMilliseconds / 1000
    self.outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: outputRate, channels: 1, interleaved: true)!
  }

  /// Converts and returns zero or more complete chunks. Leftover samples carry over to the next call.
  func push(_ samples: [Float], sampleRate: Double) -> [Data] {
    guard !samples.isEmpty, sampleRate > 0 else { return [] }
    return state.withLockUnchecked { state in
      let converted: Data
      if sampleRate == outputRate {
        converted = Self.int16(samples)
      } else {
        if state.converter == nil || state.inputRate != sampleRate {
          let inFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
          state.converter = AVAudioConverter(from: inFormat, to: outputFormat)
          state.inputRate = sampleRate
        }
        guard let converter = state.converter else { return [] }
        converted = Self.resample(samples, sampleRate: sampleRate, with: converter, to: outputFormat)
      }
      state.pending.append(converted)
      let chunkBytes = chunkSamples * 2
      var out: [Data] = []
      while state.pending.count >= chunkBytes {
        out.append(Data(state.pending.prefix(chunkBytes)))
        state.pending.removeFirst(chunkBytes)
      }
      return out
    }
  }

  func reset() {
    state.withLockUnchecked { $0 = State() }
  }

  static func int16(_ samples: [Float]) -> Data {
    var data = Data(count: samples.count * 2)
    data.withUnsafeMutableBytes { raw in
      let out = raw.bindMemory(to: Int16.self)
      for (i, s) in samples.enumerated() {
        let clamped = max(-1, min(1, s))
        out[i] = Int16(clamped < 0 ? clamped * 32768 : clamped * 32767).littleEndian
      }
    }
    return data
  }

  /// RMS of a PCM16 chunk, normalised to 0...1.
  static func rms(pcm16 data: Data) -> Float {
    let count = data.count / 2
    guard count > 0 else { return 0 }
    var sum: Float = 0
    data.withUnsafeBytes { raw in
      for v in raw.bindMemory(to: Int16.self) {
        let s = Float(Int16(littleEndian: v)) / 32768
        sum += s * s
      }
    }
    return sqrt(sum / Float(count))
  }

  private static func resample(_ samples: [Float], sampleRate: Double, with converter: AVAudioConverter, to outFormat: AVAudioFormat) -> Data {
    let inFormat = converter.inputFormat
    guard let input = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(samples.count)) else { return Data() }
    input.frameLength = AVAudioFrameCount(samples.count)
    samples.withUnsafeBufferPointer { src in
      input.floatChannelData![0].update(from: src.baseAddress!, count: samples.count)
    }
    let capacity = AVAudioFrameCount(Double(samples.count) * outFormat.sampleRate / sampleRate) + 32
    guard let output = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return Data() }
    nonisolated(unsafe) var consumed = false
    var error: NSError?
    // .noDataNow (not .endOfStream) keeps the resampler's filter state across chunks.
    converter.convert(to: output, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return input
    }
    guard error == nil, let ch = output.int16ChannelData else { return Data() }
    return Data(bytes: ch[0], count: Int(output.frameLength) * 2)
  }
}
