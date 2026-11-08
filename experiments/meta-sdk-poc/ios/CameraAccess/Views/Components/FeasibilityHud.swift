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
    VStack(alignment: .leading, spacing: FlareSpace.xs) {
      FlareSectionLabel("DAT feasibility")

      HStack(spacing: 6) {
        ForEach(AudioDiagnosticMode.allCases) { mode in
          Button { onSelectMode(mode) } label: {
            Text(mode.rawValue)
              .font(.flareMono(.caption2, weight: .semibold))
              .lineLimit(1)
              .minimumScaleFactor(0.8)
              .frame(maxWidth: .infinity, minHeight: 36)
              .background(mode == audioMode ? FlareColor.accent : Color.white.opacity(0.12))
              .foregroundStyle(mode == audioMode ? FlareColor.onAccent : FlareColor.text1)
              .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
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
              .font(.flareMono(.caption2))
              .foregroundStyle(FlareColor.text2)
              .lineLimit(2)
          }
        }
        .accessibilityIdentifier("diagnostics_log_tail")
      }

      HStack(spacing: FlareSpace.xs) {
        hudButton("Copy diagnostics log", id: "copy_diagnostics_button", action: onCopyLog)
        hudButton("Clear", id: "clear_diagnostics_button", action: onClearLog)
          .frame(width: 80)
      }
    }
    .padding(FlareSpace.md)
    .background(Color.black.opacity(0.6))
    .clipShape(RoundedRectangle(cornerRadius: FlareRadius.card, style: .continuous))
    .accessibilityIdentifier("feasibility_hud")
  }

  private func hudButton(_ title: String, id: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(.caption.weight(.semibold))
        .foregroundStyle(FlareColor.text1)
        .frame(maxWidth: .infinity, minHeight: 44)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
    .accessibilityIdentifier(id)
  }

  private func metricRow(title: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title)
        .font(.caption2)
        .foregroundStyle(FlareColor.text3)
      Text(value)
        .font(.flareMono(.caption, weight: .medium))
        .foregroundStyle(FlareColor.text1)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private func levelBar(level: Float, caption: String) -> some View {
    VStack(alignment: .leading, spacing: FlareSpace.xxs) {
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(Color.white.opacity(0.15))
          Capsule()
            .fill(FlareColor.ok)
            .frame(width: geo.size.width * CGFloat(min(max(level * 4, 0), 1)))
        }
      }
      .frame(height: 6)
      Text(caption)
        .font(.flareMono(.caption2))
        .foregroundStyle(FlareColor.text2)
    }
  }
}
