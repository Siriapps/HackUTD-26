/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Keeps Gemini from hearing itself. The glasses' open-ear speakers sit centimetres from
 * their microphones, so while Gemini is talking (and briefly after) mic chunks are replaced
 * with silence. A run of loud chunks counts as the technician talking over Gemini: the gate
 * opens, the held chunks are released, and the caller stops local playback (barge-in).
 */

import Foundation

struct EchoGate: Sendable {
  enum Decision: Equatable, Sendable {
    /// Send these chunks as they are (the current chunk, plus any held loud chunks on barge-in).
    case send([Data])
    /// Send silence of the same length instead.
    case mute
    /// The technician is talking over Gemini: stop playback and send these chunks.
    case bargeIn([Data])
  }

  var enabled = true
  var allowBargeIn = true
  /// Normalised RMS a chunk needs to count toward barge-in.
  var bargeInRms: Float = 0.06
  /// Consecutive loud chunks needed (3 x 40 ms).
  var bargeInChunks = 3

  private var held: [Data] = []
  private var open = false

  mutating func decide(chunk: Data, rms: Float, assistantAudible: Bool) -> Decision {
    guard enabled, assistantAudible else {
      held.removeAll()
      open = false
      return .send([chunk])
    }
    if open { return .send([chunk]) }
    guard allowBargeIn, rms >= bargeInRms else {
      held.removeAll()
      return .mute
    }
    held.append(chunk)
    guard held.count >= bargeInChunks else { return .mute }
    open = true
    let out = held
    held.removeAll()
    return .bargeIn(out)
  }

  mutating func reset() {
    held.removeAll()
    open = false
  }
}
