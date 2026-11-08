@testable import CameraAccess
import MWDATCore
import XCTest

final class StreamDiagnosticsTests: XCTestCase {
  private let wifiKeys: [String: Any] = [
    "NSLocalNetworkUsageDescription": "glasses Wi-Fi",
    "NSBonjourServices": ["_bonjour._tcp"],
  ]

  func testClassicWinsWhenBothTransportsDeclared() {
    var info = wifiKeys
    info["UIBackgroundModes"] = ["bluetooth-central", "external-accessory"]
    info["UISupportedExternalAccessoryProtocols"] = ["com.meta.ar.wearable"]
    XCTAssertEqual(DeclaredStreamTransport.from(infoDictionary: info), .bluetoothClassic)
  }

  func testClassicNeedsBothBackgroundModeAndProtocol() {
    var info = wifiKeys
    info["UIBackgroundModes"] = ["external-accessory"]
    XCTAssertEqual(DeclaredStreamTransport.from(infoDictionary: info), .wifi)
  }

  func testWifiNeedsNonEmptyBonjourServices() {
    XCTAssertEqual(DeclaredStreamTransport.from(infoDictionary: wifiKeys), .wifi)
    var info = wifiKeys
    info["NSBonjourServices"] = [String]()
    XCTAssertEqual(DeclaredStreamTransport.from(infoDictionary: info), .none)
  }

  func testShippedInfoPlistDeclaresClassic() {
    XCTAssertEqual(DeclaredStreamTransport.from(infoDictionary: Bundle.main.infoDictionary ?? [:]), .bluetoothClassic)
  }

  func testProfileParsingReadsWifiEntitlements() {
    let plist = """
      <?xml version="1.0" encoding="UTF-8"?>
      <plist version="1.0"><dict><key>Entitlements</key><dict>
      <key>com.apple.developer.networking.wifi-info</key><true/>
      </dict></dict></plist>
      """
    var data = Data([0x30, 0x82, 0x01])
    data.append(Data(plist.utf8))
    data.append(Data([0x00, 0xA0]))
    XCTAssertEqual(
      ProfileWifiEntitlements.from(profileData: data),
      ProfileWifiEntitlements(hotspotConfiguration: false, wifiInfo: true)
    )
    XCTAssertNil(ProfileWifiEntitlements.from(profileData: Data([0x00, 0x01])))
  }

  func testAudioModesOpenExactlyOnePathOrNone() {
    XCTAssertFalse(AudioDiagnosticMode.videoOnly.usesHfp)
    XCTAssertFalse(AudioDiagnosticMode.videoOnly.usesInBandPcm)
    XCTAssertTrue(AudioDiagnosticMode.videoPcm.usesInBandPcm)
    XCTAssertFalse(AudioDiagnosticMode.videoPcm.usesHfp)
    XCTAssertTrue(AudioDiagnosticMode.videoHfp.usesHfp)
    XCTAssertFalse(AudioDiagnosticMode.videoHfp.usesInBandPcm)
  }

  @MainActor
  func testVideoOnlyIsTheDefaultMode() {
    let viewModel = CameraViewModel(wearables: Wearables.shared)
    XCTAssertEqual(viewModel.audioMode, .videoOnly)
    XCTAssertFalse(viewModel.includeAudioInStream)
  }

  func testTransportMarkerClassification() {
    let classicRun = [
      "[TransportDiscoveryFactory] Transport support - BLE: true, BTC: true",
      "requestBTC success",
      "WarpTransport: sent VideoStartRequest: low",
    ]
    XCTAssertEqual(
      SDKTransportEvidence.classify(classicRun),
      "BTC=true BTCfailure=false SoftAP=false fallbackToSoftAP=false VideoStartRequest=true AudioStartRequest=false"
    )
    let fallbackRun = ["requestBTC failure: x", "falling back to SoftAP", "WarpTransport: sent AudioStartRequest: pcm"]
    XCTAssertEqual(
      SDKTransportEvidence.classify(fallbackRun),
      "BTC=false BTCfailure=true SoftAP=true fallbackToSoftAP=true VideoStartRequest=false AudioStartRequest=true"
    )
    XCTAssertTrue(SDKTransportEvidence.classify(["SoftAP never started (wifiInUse)."]).contains("SoftAP=false"))
  }

  func testSdkLogRedaction() {
    let line = "BTC record for 1A2B3C4D-1111-2222-3333-444455556666, serialNumber: 1WMXA9Z, key a1b2c3d4e5f6a7b8"
    let redacted = SDKTransportEvidence.redact(line)
    XCTAssertFalse(redacted.contains("1A2B3C4D"))
    XCTAssertFalse(redacted.contains("1WMXA9Z"))
    XCTAssertFalse(redacted.contains("a1b2c3d4e5f6a7b8"))
    XCTAssertTrue(redacted.hasPrefix("BTC record for <redacted>"))
  }

  func testRedactionIsStableAndHidesIdentifier() {
    let id = "f4ccefd394b6cd1f465b5cbbb88546b1"
    let tag = StreamDiagnostics.redact(id)
    XCTAssertEqual(tag, StreamDiagnostics.redact(id))
    XCTAssertNotEqual(tag, StreamDiagnostics.redact("another-device"))
    XCTAssertFalse(tag.contains(id))
    XCTAssertTrue(tag.hasPrefix("dev#"))
    XCTAssertEqual(tag.count, 12)
  }
}
