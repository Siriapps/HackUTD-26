@testable import CameraAccess
import XCTest

final class StreamFeasibilityTests: XCTestCase {
  func testRmsLevelOfSilenceIsZero() {
    XCTAssertEqual(StreamFeasibility.rmsLevel([]), 0)
    XCTAssertEqual(StreamFeasibility.rmsLevel([0, 0, 0, 0]), 0)
  }

  func testRmsLevelOfConstantTone() {
    let samples: [Float] = Array(repeating: 0.5, count: 8)
    XCTAssertEqual(StreamFeasibility.rmsLevel(samples), 0.5, accuracy: 0.0001)
  }

  func testFramesPerSecondRequiresElapsedTime() {
    XCTAssertEqual(StreamFeasibility.framesPerSecond(frameCount: 24, elapsedSeconds: 0), 0)
    XCTAssertEqual(StreamFeasibility.framesPerSecond(frameCount: 24, elapsedSeconds: 1), 24, accuracy: 0.001)
    XCTAssertEqual(StreamFeasibility.framesPerSecond(frameCount: 12, elapsedSeconds: 0.5), 24, accuracy: 0.001)
  }
}
