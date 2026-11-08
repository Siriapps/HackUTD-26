/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Drives the Flare Live screen with a MockDeviceKit device (plant.mp4 feed, not glasses video).
 * Screenshots are attached to the result bundle; FLARE_UI_SHOTS=<dir> also writes them as PNGs.
 * With FLARE_E2E_SERVER set, it also starts a real Gemini Live call through the mock feed.
 */

import MWDATMockDeviceTestClient
import XCTest

@MainActor
final class FlareLiveUITests: XCTestCase {
  private let portFilePath = NSTemporaryDirectory() + "mwdat_test_server_port_\(UUID().uuidString).txt"
  private let app = XCUIApplication()
  private var mockClient: MockDeviceTestClient!
  private var deviceId: String?

  override func setUp() async throws {
    continueAfterFailure = false
    // `-key value` lands in UserDefaults' argument domain, which FlareLiveController reads.
    let server = ProcessInfo.processInfo.environment["FLARE_E2E_SERVER"] ?? ""
    // MockDeviceKit has no in-stream PCM, so the mock run uses the camera-only path and a typed question.
    app.launchArguments = [
      "--ui-testing", "--flare-live", "-flare.serverURL", server, "-flare.eventId", "FIX-LEAK", "-flare.micPath", "VIDEO_ONLY",
    ]
    app.launchEnvironment["MWDAT_TEST_SERVER_PORT_FILE"] = portFilePath
    app.launch()
    mockClient = MockDeviceTestClient(portFilePath: portFilePath)
    let reachable = await mockClient.waitForServer(timeout: 10)
    XCTAssertTrue(reachable, "MockDeviceKit test server should be running")
  }

  override func tearDown() async throws {
    if let deviceId { _ = await mockClient.unpairDevice(deviceId: deviceId) }
    app.terminate()
    try? FileManager.default.removeItem(atPath: portFilePath)
  }

  func testFlareLiveScreen() async throws {
    let connect = app.buttons["Connect my glasses"]
    XCTAssertTrue(connect.waitForExistence(timeout: 10))
    connect.tap()
    XCTAssertTrue(app.staticTexts["Flare · Glasses Live"].waitForExistence(timeout: 15), "registered app opens on Flare Live")
    shot("flare-1-registered-no-device")

    deviceId = await mockClient.pairDevice()
    XCTAssertNotNil(deviceId)
    if let deviceId {
      _ = await mockClient.setCameraFeed(deviceId: deviceId, resourceName: "plant", ext: "mp4")
    }
    let start = app.buttons["Start Live"]
    XCTAssertTrue(start.waitForExistence(timeout: 15))
    let enabled = NSPredicate(format: "isEnabled == true")
    await fulfillment(of: [expectation(for: enabled, evaluatedWith: start)], timeout: 15)

    let env = ProcessInfo.processInfo.environment
    shot("flare-2-device-active")
    guard env["FLARE_E2E_SERVER"] != nil else { return }
    start.tap()

    // MockDeviceKit streams over Wi-Fi, so the first stream asks for Local Network access.
    let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
    if allow.waitForExistence(timeout: 10) { allow.tap() }
    let live = app.staticTexts["Live"]
    let reachedLive = live.waitForExistence(timeout: 45)
    shot("flare-3-after-start")
    guard reachedLive else {
      XCTFail("did not reach Live; see flare-3-after-start")
      return
    }
    app.buttons["Ask (typed): What am I looking at?"].tap()
    try await Task.sleep(for: .seconds(14))
    shot("flare-4-live-answer")
    app.buttons["End session"].tap()
    XCTAssertTrue(app.buttons["Start Live again"].waitForExistence(timeout: 15))
    shot("flare-5-ended")
  }

  private func shot(_ name: String) {
    let screenshot = XCUIScreen.main.screenshot()
    let attachment = XCTAttachment(screenshot: screenshot)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    if let dir = ProcessInfo.processInfo.environment["FLARE_UI_SHOTS"] {
      try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
  }
}
