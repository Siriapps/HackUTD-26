/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Minimal control screen for the hands-free glasses call: settings, Start/End, live status and
 * a debug transcript. Once the call is live the technician never needs to touch the phone.
 */

import MWDATCore
import SwiftUI

struct FlareLiveView: View {
  @State private var controller: FlareLiveController
  var wearablesVM: WearablesViewModel
  let onOpenDiagnostics: () -> Void

  init(wearables: WearablesInterface, wearablesVM: WearablesViewModel, onOpenDiagnostics: @escaping () -> Void) {
    self._controller = State(wrappedValue: FlareLiveController(wearables: wearables))
    self.wearablesVM = wearablesVM
    self.onOpenDiagnostics = onOpenDiagnostics
  }

  private var active: Bool { controller.phase.isActive }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          header
          glassesStatus
          settings
          primaryButton
          if let error = controller.errorMessage {
            Text(error).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
          }
          if controller.showPreview, let image = controller.previewImage {
            Image(uiImage: image).resizable().aspectRatio(contentMode: .fit).frame(maxHeight: 220)
              .clipShape(RoundedRectangle(cornerRadius: 10)).frame(maxWidth: .infinity)
          }
          metrics
          if controller.phase == .live {
            Button("Ask (typed): What am I looking at?") { controller.askTyped("What am I looking at right now?") }
              .buttonStyle(.bordered).font(.footnote)
          }
          transcript
          footer
        }
        .padding(16)
      }
      .onChange(of: controller.lines.count) {
        if let last = controller.lines.last { proxy.scrollTo(last.id, anchor: .bottom) }
      }
    }
    .background(Color(red: 0.04, green: 0.06, blue: 0.10).ignoresSafeArea())
    .preferredColorScheme(.dark)
    .task { await autostartIfRequested() }
  }

  /// Debug: `--flare-autostart` starts the call as soon as the glasses are active, for device runs driven from the Mac.
  private func autostartIfRequested() async {
    #if DEBUG
    guard ProcessInfo.processInfo.arguments.contains("--flare-autostart") else { return }
    for _ in 0..<120 where !controller.glasses.hasActiveDevice {
      try? await Task.sleep(for: .milliseconds(500))
    }
    print("[flare] autostart: device active=\(controller.glasses.hasActiveDevice) registration=\(wearablesVM.registrationState.description)")
    guard controller.glasses.hasActiveDevice, !controller.phase.isActive else { return }
    await controller.start()
    #endif
  }

  private var header: some View {
    HStack {
      Text("Flare · Glasses Live").font(.title3.weight(.semibold))
      Spacer()
      Text(controller.phase.rawValue)
        .font(.caption.weight(.semibold).monospaced())
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(controller.phase == .live ? Color.green.opacity(0.25) : Color.white.opacity(0.08), in: Capsule())
    }
  }

  private var glassesStatus: some View {
    VStack(alignment: .leading, spacing: 4) {
      row("Glasses", wearablesVM.registrationState == .registered ? "registered" : wearablesVM.registrationState.description)
      row("Device", controller.glasses.hasActiveDevice ? "active" : "not active — put on and unfold the glasses", warn: !controller.glasses.hasActiveDevice)
      row("DAT session", controller.glasses.sessionState.description)
      row("Camera stream", "\(controller.glasses.streamState)")
    }
  }

  private var settings: some View {
    @Bindable var c = controller
    return VStack(alignment: .leading, spacing: 8) {
      TextField("Server, e.g. http://your-mac.local:3000", text: $c.serverURL)
        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      SecureField("Device token (FIELD_DEVICE_TOKEN, optional in dev)", text: $c.deviceToken)
      HStack {
        TextField("Event ID", text: $c.eventId).textInputAutocapitalization(.characters).autocorrectionDisabled()
        TextField("Folder (optional)", text: $c.folder).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      Picker("Mic path", selection: $c.micPath) {
        ForEach(GlassesMicPath.allCases) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
      Toggle("Barge-in (talk over Gemini)", isOn: $c.allowBargeIn)
      Toggle("Camera preview", isOn: $c.showPreview)
    }
    .textFieldStyle(.roundedBorder)
    .font(.callout)
    .disabled(active)
  }

  private var primaryButton: some View {
    Group {
      if active {
        Button(role: .destructive) {
          Task { await controller.end("Call ended.") }
        } label: {
          Text(controller.phase == .ending ? "Ending…" : "End session").frame(maxWidth: .infinity)
        }
        .disabled(controller.phase == .ending)
      } else {
        Button {
          Task { await controller.start() }
        } label: {
          Text(controller.phase == .ended ? "Start Live again" : "Start Live").frame(maxWidth: .infinity)
        }
        .disabled(!controller.glasses.hasActiveDevice)
      }
    }
    .buttonStyle(.borderedProminent)
    .tint(active ? .red : .orange)
    .controlSize(.large)
  }

  private var metrics: some View {
    VStack(alignment: .leading, spacing: 4) {
      row("Video from glasses", "\(controller.glassesFrames) frames · \(String(format: "%.1f", controller.glassesFps)) fps")
      row("Video to Gemini", "\(controller.framesSentToGemini) sent · \(controller.framesDropped) dropped")
      HStack(spacing: 8) {
        Text("Mic").foregroundStyle(.secondary).frame(width: 130, alignment: .leading)
        ProgressView(value: Double(min(1, controller.micLevel * 6))).tint(controller.micMuted ? .gray : .green)
        Text(!active || controller.micPath == .videoOnly ? "off" : controller.micMuted ? "muted" : "open")
          .font(.caption.monospaced()).foregroundStyle(.secondary)
      }
      .font(.footnote)
      row("Mic input", controller.inputRoute)
      row("Audio to Gemini", "\(controller.audioChunksSent) chunks · \(controller.audioChunksDropped) dropped")
      row("Gemini voice", controller.outputRoute, warn: active && !controller.outputOnGlasses)
      row("Gemini", controller.phase == .live ? (controller.geminiSpeaking ? "speaking" : "listening") : controller.model.ifBlank("—"))
      if !controller.eventLabel.isEmpty { row("Context", controller.eventLabel) }
      if controller.keyframes > 0 { row("Observation frames", "\(controller.keyframes) (memory only)") }
    }
  }

  private var transcript: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(controller.lines.suffix(60)) { line in
        Text(line.text)
          .font(line.role == .system ? .caption : .callout)
          .foregroundStyle(line.role == .system ? Color.secondary : line.role == .gemini ? Color.cyan : Color.primary)
          .frame(maxWidth: .infinity, alignment: line.role == .tech ? .trailing : .leading)
          .multilineTextAlignment(line.role == .tech ? .trailing : .leading)
          .id(line.id)
      }
    }
  }

  private var footer: some View {
    VStack(spacing: 10) {
      HStack {
        Button("Diagnostics (POC)", action: onOpenDiagnostics).disabled(active)
        Spacer()
        Button("Copy log") { UIPasteboard.general.string = StreamDiagnosticsLog.shared.text }
        Spacer()
        Button("Disconnect", role: .destructive) { wearablesVM.disconnectGlasses() }.disabled(active)
      }
      .font(.footnote)
      Text("© 2026 Avon Corps").font(.caption2).foregroundStyle(.secondary)
    }
    .padding(.top, 8)
  }

  private func row(_ label: String, _ value: String, warn: Bool = false) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(label).foregroundStyle(.secondary).frame(width: 130, alignment: .leading)
      Text(value).foregroundStyle(warn ? Color.orange : Color.primary).fixedSize(horizontal: false, vertical: true)
    }
    .font(.footnote)
  }
}

extension String {
  fileprivate func ifBlank(_ fallback: String) -> String { isEmpty ? fallback : self }
}
