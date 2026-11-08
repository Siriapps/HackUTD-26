/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * On-screen proof that the DAT camera stream is live, and that glasses-mic
 * samples are (or are not) arriving. Does not claim hardware success on its own.
 */

import SwiftUI

struct FeasibilityHud: View {
  let videoFrameCount: Int
  let videoFps: Double
  let datInBandStatus: String
  let datInBandSampleCount: Int
  let datInBandLevel: Float
  let hfpStatus: String
  let hfpSampleCount: Int
  let hfpLevel: Float
  let hfpTestRunning: Bool
  let hfpTestEnabled: Bool
  let onToggleHfpTest: () -> Void
  let transportLabel: String
  let audioMode: AudioDiagnosticMode
  let modeSelectionEnabled: Bool
  let onSelectMode: (AudioDiagnosticMode) -> Void
  let recentLogLines: [String]
  let onCopyLog: () -> Void
  let onClearLog: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("DAT feasibility")
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(.white.opacity(0.7))

      HStack(spacing: 6) {
        ForEach(AudioDiagnosticMode.allCases) { mode in
          Button { onSelectMode(mode) } label: {
            Text(mode.rawValue)
              .font(.system(size: 11, weight: .semibold).monospaced())
              .frame(maxWidth: .infinity)
              .padding(.vertical, 7)
              .background(mode == audioMode ? Color.white.opacity(0.85) : Color.white.opacity(0.12))
              .foregroundStyle(mode == audioMode ? Color.black : Color.white)
              .clipShape(RoundedRectangle(cornerRadius: 7))
          }
          .accessibilityIdentifier("audio_mode_\(mode.rawValue)")
        }
      }
      .disabled(!modeSelectionEnabled)
      .opacity(modeSelectionEnabled ? 1 : 0.55)

      metricRow(title: "Declared stream transport (Info.plist, not SDK-confirmed)", value: transportLabel)
      metricRow(title: "Video frames", value: "\(videoFrameCount)  ·  \(String(format: "%.1f", videoFps)) fps")
      metricRow(title: "DAT in-band mic", value: datInBandStatus)
      if datInBandSampleCount > 0 {
        levelBar(level: datInBandLevel, caption: "\(datInBandSampleCount) PCM buffers")
      }
      metricRow(title: "HFP glasses mic", value: hfpStatus)
      if hfpSampleCount > 0 {
        levelBar(level: hfpLevel, caption: "\(hfpSampleCount) PCM buffers")
      }

      if audioMode.usesHfp {
        hudButton(hfpTestRunning ? "Stop HFP test" : "Start HFP test", id: "hfp_audio_test_button", action: onToggleHfpTest)
          .disabled(!hfpTestEnabled && !hfpTestRunning)
          .opacity((hfpTestEnabled || hfpTestRunning) ? 1 : 0.4)
      }

      if !recentLogLines.isEmpty {
        VStack(alignment: .leading, spacing: 2) {
          ForEach(Array(recentLogLines.enumerated()), id: \.offset) { _, line in
            Text(line)
              .font(.system(size: 9).monospaced())
              .foregroundStyle(.white.opacity(0.8))
              .lineLimit(2)
          }
        }
        .accessibilityIdentifier("diagnostics_log_tail")
      }

      HStack(spacing: 8) {
        hudButton("Copy diagnostics log", id: "copy_diagnostics_button", action: onCopyLog)
        hudButton("Clear", id: "clear_diagnostics_button", action: onClearLog)
          .frame(width: 72)
      }
    }
    .padding(12)
    .background(Color.black.opacity(0.55))
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .accessibilityIdentifier("feasibility_hud")
  }

  private func hudButton(_ title: String, id: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(.system(size: 12, weight: .semibold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    .accessibilityIdentifier(id)
  }

  private func metricRow(title: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title)
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(.white.opacity(0.55))
      Text(value)
        .font(.system(size: 12, weight: .medium).monospaced())
        .foregroundStyle(.white)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private func levelBar(level: Float, caption: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(Color.white.opacity(0.15))
          Capsule()
            .fill(Color.green)
            .frame(width: geo.size.width * CGFloat(min(max(level * 4, 0), 1)))
        }
      }
      .frame(height: 6)
      Text(caption)
        .font(.system(size: 10).monospaced())
        .foregroundStyle(.white.opacity(0.7))
    }
  }
}
