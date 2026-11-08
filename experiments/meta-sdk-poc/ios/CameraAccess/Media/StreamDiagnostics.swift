/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Timestamped diagnostics for locating where a DAT camera stream fails:
 * registration, device link, session, camera, stream, frames, audio route.
 * Device identifiers are hashed before they are logged.
 */

import AVFoundation
import CryptoKit
import ExternalAccessory
import Foundation
import Observation
import OSLog
import os

/// Which glasses-audio path runs alongside the camera stream. One mode per device session, so
/// each run starts from a fresh session with only its own audio path open.
enum AudioDiagnosticMode: String, CaseIterable, Identifiable {
  /// No HFP, no DAT PCM: `StreamConfiguration(videoCodec:resolution:frameRate:)`.
  case videoOnly = "VIDEO_ONLY"
  /// DAT in-band PCM on the camera stream (experimental); HFP closed.
  case videoPcm = "VIDEO_PCM"
  /// Bluetooth HFP glasses mic opened before the stream; DAT PCM off.
  case videoHfp = "VIDEO_HFP"

  var id: String { rawValue }
  var usesInBandPcm: Bool { self == .videoPcm }
  var usesHfp: Bool { self == .videoHfp }
}

/// Whether iOS currently exposes the Meta glasses as an External Accessory speaking the
/// Bluetooth Classic protocol to this app. Necessary for a Classic stream, not proof of one.
enum AccessoryEvidence {
  static func summary() -> String {
    let accessories = EAAccessoryManager.shared().connectedAccessories
    let meta = accessories.filter { $0.protocolStrings.contains(DeclaredStreamTransport.classicAccessoryProtocol) }
    return "EA accessories connected=\(accessories.count), with \(DeclaredStreamTransport.classicAccessoryProtocol)=\(meta.count)"
  }
}

/// Reads the SDK's own transport log lines back from this process's unified log. DAT has no
/// public transport API, but MWDATCore/MWDATCamera log BTC (Bluetooth Classic), SoftAP (Wi-Fi)
/// and WARP stream-control events; whether a given line is emitted depends on SDK log levels.
enum SDKTransportEvidence {
  static let markers = [
    "TransportDiscoveryFactory", "requestBTC", "BTCSecureLink", "EAConnection", "BTCTransport",
    "SoftAP", "selectHighTransport", "falling back", "WarpTransport", "L2Cap",
  ]

  struct Result: Equatable {
    var scannedEntries: Int
    var lines: [String]
  }

  /// Blocking; call off the main actor.
  static func collect(since start: Date, limit: Int = 40) -> Result {
    guard let store = try? OSLogStore(scope: .currentProcessIdentifier),
      let entries = try? store.getEntries(at: store.position(date: start))
    else { return Result(scannedEntries: -1, lines: []) }
    var scanned = 0
    var lines: [String] = []
    var seen = Set<String>()
    for case let entry as OSLogEntryLog in entries {
      scanned += 1
      guard entry.subsystem != "CameraAccess.diagnostics" else { continue }
      let message = entry.composedMessage
      guard markers.contains(where: { message.contains($0) }) else { continue }
      let line = redact(String(message.prefix(220)))
      guard seen.insert(line).inserted else { continue }
      lines.append(line)
      if lines.count >= limit { break }
    }
    return Result(scannedEntries: scanned, lines: lines)
  }

  static func classify(_ lines: [String]) -> String {
    func any(_ needles: String...) -> Bool { lines.contains { line in needles.contains { line.contains($0) } } }
    let btc = any("requestBTC success", "BTCSecureLink", "EAConnection] open", "Creating new BTCSecureLink")
    let btcFailed = any("requestBTC failure", "BTCTransportError")
    let softAP = lines.contains { $0.contains("SoftAP") && !$0.contains("SoftAP never started") }
    let fallback = any("falling back to SoftAP")
    let audioStart = any("AudioStartRequest")
    let videoStart = any("VideoStartRequest")
    return "BTC=\(btc) BTCfailure=\(btcFailed) SoftAP=\(softAP) fallbackToSoftAP=\(fallback) "
      + "VideoStartRequest=\(videoStart) AudioStartRequest=\(audioStart)"
  }

  /// Strips UUIDs, long hex runs and serial numbers the SDK may include.
  static func redact(_ line: String) -> String {
    var out = line
    let patterns = [
      "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}",
      "[0-9A-Fa-f]{12,}",
      "(?i)serial ?number: ?[^ ,)]+",
    ]
    for pattern in patterns {
      out = out.replacingOccurrences(of: pattern, with: "<redacted>", options: .regularExpression)
    }
    return out
  }
}

/// The camera-stream transport this build declares in its Info.plist. DAT 1.0.x has no public
/// API that reports the transport it picked; Meta's guidance (issues #276, #354, #356) is that
/// the Info.plist decides: Bluetooth Classic when `external-accessory` and the
/// `com.meta.ar.wearable` accessory protocol are declared (even if Wi-Fi keys are present),
/// otherwise Wi-Fi when the Local Network and Bonjour keys are declared.
enum DeclaredStreamTransport: Equatable {
  case bluetoothClassic
  case wifi
  case none

  static let classicAccessoryProtocol = "com.meta.ar.wearable"

  static func from(infoDictionary info: [String: Any]) -> DeclaredStreamTransport {
    let backgroundModes = info["UIBackgroundModes"] as? [String] ?? []
    let accessoryProtocols = info["UISupportedExternalAccessoryProtocols"] as? [String] ?? []
    if backgroundModes.contains("external-accessory"), accessoryProtocols.contains(classicAccessoryProtocol) {
      return .bluetoothClassic
    }
    let localNetwork = (info["NSLocalNetworkUsageDescription"] as? String).map { !$0.isEmpty } ?? false
    let bonjour = !(info["NSBonjourServices"] as? [String] ?? []).isEmpty
    if localNetwork, bonjour {
      return .wifi
    }
    return .none
  }

  var label: String {
    switch self {
    case .bluetoothClassic: return "Bluetooth Classic"
    case .wifi: return "Wi-Fi"
    case .none: return "none declared"
    }
  }
}

/// Wi-Fi entitlements granted by the embedded provisioning profile. The signed entitlements are
/// what count; the profile is the closest thing readable at runtime and is a ceiling for them.
struct ProfileWifiEntitlements: Equatable {
  var hotspotConfiguration: Bool
  var wifiInfo: Bool

  static func from(profileData data: Data) -> ProfileWifiEntitlements? {
    guard let start = data.range(of: Data("<?xml".utf8)),
      let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex)
    else { return nil }
    let plistData = data.subdata(in: start.lowerBound..<end.upperBound)
    guard
      let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
      let entitlements = plist["Entitlements"] as? [String: Any]
    else { return nil }
    return ProfileWifiEntitlements(
      hotspotConfiguration: entitlements["com.apple.developer.networking.HotspotConfiguration"] as? Bool ?? false,
      wifiInfo: entitlements["com.apple.developer.networking.wifi-info"] as? Bool ?? false
    )
  }

  static func fromMainBundle() -> ProfileWifiEntitlements? {
    guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url)
    else { return nil }
    return from(profileData: data)
  }
}

enum StreamDiagnostics {
  /// Stable, non-reversible short tag for a device identifier so log lines can be correlated
  /// without sharing the identifier itself.
  static func redact(_ identifier: String) -> String {
    let digest = SHA256.hash(data: Data(identifier.utf8))
    return "dev#" + digest.prefix(4).map { String(format: "%02x", $0) }.joined()
  }

  /// Port types only (no port names, which include the glasses' name).
  static func audioRouteSummary() -> String {
    let session = AVAudioSession.sharedInstance()
    let inputs = session.currentRoute.inputs.map(\.portType.rawValue).joined(separator: ",")
    let outputs = session.currentRoute.outputs.map(\.portType.rawValue).joined(separator: ",")
    return "category=\(session.category.rawValue) in=[\(inputs)] out=[\(outputs)]"
  }

  static func isHfpInputActive() -> Bool {
    AVAudioSession.sharedInstance().currentRoute.inputs.contains { $0.portType == .bluetoothHFP }
  }

  static func buildConfigurationSummary() -> String {
    let info = Bundle.main.infoDictionary ?? [:]
    let transport = DeclaredStreamTransport.from(infoDictionary: info)
    let profile: String
    if let wifi = ProfileWifiEntitlements.fromMainBundle() {
      profile = "profile HotspotConfiguration=\(wifi.hotspotConfiguration) wifi-info=\(wifi.wifiInfo)"
    } else {
      profile = "profile unreadable"
    }
    return "declared transport=\(transport.label) (Info.plist, not SDK-confirmed); \(profile); \(AccessoryEvidence.summary())"
  }
}

/// In-app ring buffer of diagnostic lines, mirrored to the unified log (Xcode console /
/// Console.app, subsystem `CameraAccess.diagnostics`) so a failed attempt can be copied
/// off the phone.
@Observable
@MainActor
final class StreamDiagnosticsLog {
  static let shared = StreamDiagnosticsLog()

  private(set) var lines: [String] = []

  @ObservationIgnored private let logger = Logger(subsystem: "CameraAccess.diagnostics", category: "stream")
  @ObservationIgnored private let maxLines = 400
  @ObservationIgnored private var attemptStart: Date?
  @ObservationIgnored private let clock: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm:ss.SSS"
    return formatter
  }()

  /// Seconds since the current stream attempt began, or nil outside an attempt.
  var elapsedInAttempt: TimeInterval? {
    attemptStart.map { Date().timeIntervalSince($0) }
  }

  func beginAttempt() {
    attemptStart = Date()
  }

  func endAttempt() {
    attemptStart = nil
  }

  func log(_ category: String, _ message: String) {
    let elapsed = elapsedInAttempt.map { String(format: " +%.2fs", $0) } ?? ""
    let line = "\(clock.string(from: Date()))\(elapsed) [\(category)] \(message)"
    lines.append(line)
    if lines.count > maxLines {
      lines.removeFirst(lines.count - maxLines)
    }
    logger.notice("\(line, privacy: .public)")
  }

  var text: String { lines.joined(separator: "\n") }

  func clear() {
    lines.removeAll()
  }
}
