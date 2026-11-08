/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Small helpers for the DAT feasibility HUD. Kept free of Wearables types so
 * they can be unit-tested without glasses or MockDeviceKit.
 */

import Foundation

enum StreamFeasibility {
  /// Root-mean-square amplitude of a PCM buffer. Used as a live audio-level meter.
  static func rmsLevel(_ samples: [Float]) -> Float {
    guard !samples.isEmpty else { return 0 }
    var sumSquares: Float = 0
    for sample in samples {
      sumSquares += sample * sample
    }
    return sqrt(sumSquares / Float(samples.count))
  }

  /// Instantaneous frames-per-second from a count of frames over an elapsed window.
  static func framesPerSecond(frameCount: Int, elapsedSeconds: TimeInterval) -> Double {
    guard elapsedSeconds > 0, frameCount >= 0 else { return 0 }
    return Double(frameCount) / elapsedSeconds
  }
}
