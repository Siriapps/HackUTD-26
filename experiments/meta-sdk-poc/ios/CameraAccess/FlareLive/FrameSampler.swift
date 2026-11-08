/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Latest-frame slot between the glasses decoder (~24 fps) and Gemini Live (~1 fps).
 * Each tick takes the newest decoded frame, downsizes it with its aspect ratio intact and
 * JPEG-encodes it. Older frames are overwritten, never queued, so a slow uplink only ever
 * costs freshness, not memory or latency.
 */

import CoreGraphics
import Foundation
import UIKit
import os

final class FrameSampler: Sendable {
  struct Settings: Sendable {
    var maxEdge: Int = 768
    var jpegQuality: CGFloat = 0.6
    /// A frame older than this is treated as a stalled stream and not sent.
    var maxAge: TimeInterval = 2
  }

  private struct Slot {
    var image: UIImage?
    var at: Date = .distantPast
    var takenSinceOffer = true
  }

  let settings: Settings
  private let slot = OSAllocatedUnfairLock(uncheckedState: Slot())

  init(settings: Settings = Settings()) {
    self.settings = settings
  }

  /// Called for every decoded frame.
  func offer(_ image: UIImage, at date: Date = Date()) {
    slot.withLockUnchecked { $0 = Slot(image: image, at: date, takenSinceOffer: false) }
  }

  /// The newest frame not yet taken, if it is fresh enough.
  func takeFresh(now: Date = Date()) -> UIImage? {
    slot.withLockUnchecked { s in
      guard let image = s.image, !s.takenSinceOffer, now.timeIntervalSince(s.at) <= settings.maxAge else { return nil }
      s.takenSinceOffer = true
      return image
    }
  }

  /// The newest frame regardless of age, for keyframes attached to observations.
  func latest() -> UIImage? {
    slot.withLockUnchecked { $0.image }
  }

  func reset() {
    slot.withLockUnchecked { $0 = Slot() }
  }

  func jpeg(_ image: UIImage) -> Data? {
    guard let cg = image.cgImage else { return image.jpegData(compressionQuality: settings.jpegQuality) }
    let size = Self.scaledSize(width: cg.width, height: cg.height, maxEdge: settings.maxEdge)
    if size.width == cg.width && size.height == cg.height {
      return UIImage(cgImage: cg).jpegData(compressionQuality: settings.jpegQuality)
    }
    guard
      let ctx = CGContext(
        data: nil, width: size.width, height: size.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)
    else { return nil }
    ctx.interpolationQuality = .medium
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: size.width, height: size.height))
    guard let scaled = ctx.makeImage() else { return nil }
    return UIImage(cgImage: scaled).jpegData(compressionQuality: settings.jpegQuality)
  }

  /// Fits the longer edge to `maxEdge`, keeping the aspect ratio. Never upscales.
  static func scaledSize(width: Int, height: Int, maxEdge: Int) -> (width: Int, height: Int) {
    let longest = max(width, height)
    guard longest > maxEdge, longest > 0 else { return (width, height) }
    let scale = Double(maxEdge) / Double(longest)
    return (max(1, Int((Double(width) * scale).rounded())), max(1, Int((Double(height) * scale).rounded())))
  }
}
