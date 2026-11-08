/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * The media-source contract between a capture device and the Gemini Live session.
 * docs/glasses-live.md describes the same contract for the web /field page, so a later
 * camera-source selector can swap sources without touching the Live session code.
 */

import Foundation
import UIKit

/// Where the technician's video and voice come from. Raw values match the web contract.
enum MediaSourceKind: String, Sendable {
  case metaGlasses = "meta_glasses"
  case phoneCamera = "phone_camera"
}

/// How the glasses microphone reaches the app. Both were verified on Ray-Ban Meta Gen 2 in the
/// feasibility POC; the phone microphone is never a fallback.
enum GlassesMicPath: String, CaseIterable, Identifiable, Sendable {
  /// DAT in-stream PCM on the camera stream (beta channel). Gemini audio plays over Bluetooth A2DP.
  case datPcm = "VIDEO_PCM"
  /// Bluetooth HFP opened before the stream. Mic and Gemini audio both use the HFP link.
  case hfp = "VIDEO_HFP"
  /// Camera only, for checking the vision path with typed questions (and MockDeviceKit, which has no PCM).
  case videoOnly = "VIDEO_ONLY"

  var id: String { rawValue }
  var label: String {
    switch self {
    case .datPcm: return "DAT PCM"
    case .hfp: return "HFP"
    case .videoOnly: return "Video only"
    }
  }
  var inputDescription: String {
    switch self {
    case .datPcm: return "Glasses mic · DAT in-stream PCM 16 kHz"
    case .hfp: return "Glasses mic · Bluetooth HFP"
    case .videoOnly: return "None (video only; use the typed question)"
    }
  }
}

/// What a media source hands the Live session. Video is decoded, upright frames at whatever rate
/// the device produces; the session samples and compresses them. Audio is mono Float32 at the
/// device's rate; the session converts it to Gemini's 16 kHz PCM16.
@MainActor
protocol FieldMediaSource: AnyObject {
  var kind: MediaSourceKind { get }
  /// Called off the main thread for every decoded frame.
  var onVideoFrame: (@Sendable (UIImage) -> Void)? { get set }
  /// Called off the main thread with mono samples and their sample rate.
  var onMicSamples: (@Sendable ([Float], Double) -> Void)? { get set }
  /// Called on the main actor when the source stops on its own (device lost, stream error).
  var onEnded: (@MainActor (String) -> Void)? { get set }
}
