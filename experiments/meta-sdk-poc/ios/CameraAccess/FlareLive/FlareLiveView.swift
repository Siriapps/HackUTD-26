/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Control screen for the hands-free glasses call. The glasses camera and the Start/End control stay
 * pinned; status, setup, telemetry and the transcript scroll between them. Once the call is live the
 * technician never needs to touch the phone.
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
    GeometryReader { geo in
      VStack(spacing: 0) {
        header
          .padding(.horizontal, FlareSpace.md)
          .padding(.top, FlareSpace.xs)
          .padding(.bottom, FlareSpace.sm)
        // Capped so the transcript and the pinned controls keep room under a portrait feed.
        GlassesPreviewPanel(
          controller: controller,
          width: max(0, geo.size.width - FlareSpace.md * 2),
          maxHeight: geo.size.height * 0.46
        )
        .padding(.horizontal, FlareSpace.md)
        ScrollViewReader { proxy in
          ScrollView {
            VStack(alignment: .leading, spacing: FlareSpace.lg) {
              glassesStatus
              settings
              TelemetrySection(controller: controller)
              transcript
              footer
            }
            .padding(FlareSpace.md)
          }
          .onChange(of: controller.lines.count) {
            if let last = controller.lines.last { proxy.scrollTo(last.id, anchor: .bottom) }
          }
          .safeAreaInset(edge: .bottom, spacing: 0) { actionBar }
        }
      }
    }
    .background(FlareColor.canvas.ignoresSafeArea())
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

  // MARK: - Header

  /// The phase sits on its own line: phase names run up to "Connecting to Gemini", and sharing the title's
  /// line would reflow the header on every phase change.
  private var header: some View {
    VStack(alignment: .leading, spacing: FlareSpace.xs) {
      Text("Flare · Glasses Live")
        .flareDisplay(size: 24, relativeTo: .title2)
        .foregroundStyle(FlareColor.text1)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
      PhaseBadge(phase: controller.phase)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  // MARK: - Sections

  private var glassesStatus: some View {
    FlareSection("Glasses") {
      VStack(alignment: .leading, spacing: FlareSpace.xs) {
        InfoRow("Glasses", wearablesVM.registrationState == .registered ? "registered" : wearablesVM.registrationState.description)
        InfoRow(
          "Device",
          controller.glasses.hasActiveDevice ? "active" : "not active — put on and unfold the glasses",
          warn: !controller.glasses.hasActiveDevice
        )
        InfoRow("DAT session", controller.glasses.sessionState.description)
        InfoRow("Camera stream", "\(controller.glasses.streamState)")
      }
    }
  }

  private var settings: some View {
    @Bindable var c = controller
    return FlareSection("Call setup") {
      VStack(alignment: .leading, spacing: FlareSpace.md) {
        LabeledField("Server") {
          TextField("Server", text: $c.serverURL, prompt: Text(verbatim: "http://your-mac.local:3000"))
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        LabeledField("Device token (optional in dev)") {
          SecureField("Device token", text: $c.deviceToken, prompt: Text(verbatim: "FIELD_DEVICE_TOKEN"))
        }
        HStack(alignment: .top, spacing: FlareSpace.sm) {
          LabeledField("Event ID") {
            TextField("Event ID", text: $c.eventId, prompt: Text("Event ID"))
              .textInputAutocapitalization(.characters).autocorrectionDisabled()
          }
          LabeledField("Folder") {
            TextField("Folder", text: $c.folder, prompt: Text("Optional"))
              .textInputAutocapitalization(.never).autocorrectionDisabled()
          }
        }
        VStack(alignment: .leading, spacing: FlareSpace.xs) {
          fieldLabel("Mic path")
          Picker("Mic path", selection: $c.micPath) {
            ForEach(GlassesMicPath.allCases) { Text($0.label).tag($0) }
          }
          .pickerStyle(.segmented)
        }
        VStack(spacing: 0) {
          settingToggle("Barge-in (talk over Gemini)", isOn: $c.allowBargeIn)
          FlareDivider()
          settingToggle("Camera preview", isOn: $c.showPreview)
          FlareDivider()
          settingToggle("Simulation mode (classroom demo)", isOn: $c.simulation)
        }
      }
    }
    .disabled(active)
  }

  @ViewBuilder
  private var transcript: some View {
    if !controller.lines.isEmpty {
      FlareSection("Transcript") {
        VStack(alignment: .leading, spacing: FlareSpace.xs) {
          ForEach(controller.lines.suffix(60)) { line in
            TranscriptLine(line: line)
              .id(line.id)
          }
        }
      }
    }
  }

  private var footer: some View {
    VStack(spacing: FlareSpace.md) {
      FlareSection("Tools") {
        VStack(spacing: 0) {
          Button(action: onOpenDiagnostics) {
            Label("Diagnostics (POC)", systemImage: "waveform.path.ecg")
          }
          .disabled(active)
          FlareDivider()
          Button {
            UIPasteboard.general.string = StreamDiagnosticsLog.shared.text
          } label: {
            Label("Copy log", systemImage: "doc.on.doc")
          }
          FlareDivider()
          Button(role: .destructive) {
            wearablesVM.disconnectGlasses()
          } label: {
            Label("Disconnect", systemImage: "xmark.circle")
          }
          .disabled(active)
        }
        .buttonStyle(FlareRowButtonStyle())
      }
      Text("© 2026 Avon Corps")
        .font(.caption2)
        .foregroundStyle(FlareColor.text3)
        .frame(maxWidth: .infinity)
    }
  }

  // MARK: - Pinned action bar

  private var actionBar: some View {
    VStack(spacing: FlareSpace.sm) {
      if let error = controller.errorMessage {
        Label {
          Text(error).fixedSize(horizontal: false, vertical: true)
        } icon: {
          Image(systemName: "exclamationmark.octagon.fill")
        }
        .font(.callout)
        .foregroundStyle(FlareColor.dangerText)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(FlareSpace.sm)
        .background(FlareColor.shutdown.opacity(0.14), in: RoundedRectangle(cornerRadius: FlareRadius.control, style: .continuous))
      }
      if controller.phase == .live {
        Button("Ask (typed): What am I looking at?") { controller.askTyped("What am I looking at right now?") }
          .buttonStyle(FlareButtonStyle(kind: .secondary))
      }
      primaryButton
    }
    .padding(.horizontal, FlareSpace.md)
    .padding(.top, FlareSpace.sm)
    .padding(.bottom, FlareSpace.xs)
    .background {
      FlareColor.canvas
        .overlay(alignment: .top) { FlareDivider() }
        .ignoresSafeArea(edges: .bottom)
    }
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
    .buttonStyle(FlareButtonStyle(kind: active ? .destructive : .primary))
  }

  // MARK: - Pieces

  private func fieldLabel(_ title: String) -> some View {
    Text(title)
      .font(.footnote.weight(.medium))
      .foregroundStyle(FlareColor.text2)
      .accessibilityHidden(true)
  }

  private func settingToggle(_ title: String, isOn: Binding<Bool>) -> some View {
    Toggle(title, isOn: isOn)
      .font(.body)
      .foregroundStyle(FlareColor.text1)
      .tint(FlareColor.accent)
      .frame(minHeight: 44)
  }
}

// MARK: - Glasses preview

/// The glasses camera, full content width and fitted to the frame's own aspect ratio. Isolated so the
/// ~8 fps preview updates re-render only this view.
private struct GlassesPreviewPanel: View {
  let controller: FlareLiveController
  let width: CGFloat
  let maxHeight: CGFloat

  var body: some View {
    if controller.showPreview, let image = controller.previewImage {
      let aspect = max(image.size.width, 1) / max(image.size.height, 1)
      Image(uiImage: image)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: width, height: min(width / aspect, maxHeight))
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: FlareRadius.media, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: FlareRadius.media, style: .continuous)
            .strokeBorder(FlareColor.line, lineWidth: 1)
        )
        .overlay(alignment: .topLeading) {
          Label("Glasses camera", systemImage: "eyeglasses")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, FlareSpace.xs)
            .padding(.vertical, FlareSpace.xxs)
            .background(.black.opacity(0.55), in: Capsule())
            .padding(FlareSpace.sm)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Glasses camera preview")
        .accessibilityAddTraits(.isImage)
        .padding(.bottom, FlareSpace.xs)
    }
  }
}

// MARK: - Telemetry

/// Counters and audio routes. Isolated so the frequent counter updates re-render only this card.
private struct TelemetrySection: View {
  let controller: FlareLiveController
  @ScaledMetric(relativeTo: .subheadline) private var labelWidth = flareLabelColumn

  private var active: Bool { controller.phase.isActive }

  var body: some View {
    FlareSection("Live telemetry") {
      VStack(alignment: .leading, spacing: FlareSpace.xs) {
        InfoRow("Video from glasses", "\(controller.glassesFrames) frames · \(String(format: "%.1f", controller.glassesFps)) fps", mono: true)
        InfoRow("Video to Gemini", "\(controller.framesSentToGemini) sent · \(controller.framesDropped) dropped", mono: true)
        FlareDivider().padding(.vertical, FlareSpace.xxs)
        micRow
        InfoRow("Mic input", controller.inputRoute)
        InfoRow("Audio to Gemini", "\(controller.audioChunksSent) chunks · \(controller.audioChunksDropped) dropped", mono: true)
        InfoRow("Gemini voice", controller.outputRoute, warn: active && !controller.outputOnGlasses)
        FlareDivider().padding(.vertical, FlareSpace.xxs)
        InfoRow("Gemini", controller.phase == .live ? (controller.geminiSpeaking ? "speaking" : "listening") : controller.model.ifBlank("—"))
        if !controller.eventLabel.isEmpty { InfoRow("Context", controller.eventLabel) }
        if controller.keyframes > 0 { InfoRow("Observation frames", "\(controller.keyframes) (memory only)", mono: true) }
        InfoRow("Mode", controller.simulation ? "Simulation (classroom)" : "Field (real equipment)")
      }
    }
  }

  private var micRow: some View {
    HStack(spacing: FlareSpace.sm) {
      Text("Mic")
        .font(.subheadline)
        .foregroundStyle(FlareColor.text2)
        .frame(width: labelWidth, alignment: .leading)
      ProgressView(value: Double(min(1, controller.micLevel * 6)))
        .tint(controller.micMuted ? FlareColor.text3 : FlareColor.ok)
      Text(!active || controller.micPath == .videoOnly ? "off" : controller.micMuted ? "muted" : "open")
        .font(.flareMono(.caption))
        .foregroundStyle(FlareColor.text2)
    }
    .accessibilityElement(children: .combine)
  }
}

// MARK: - Rows

private struct PhaseBadge: View {
  let phase: FlareLiveController.Phase

  var body: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(tint)
        .frame(width: 8, height: 8)
        .accessibilityHidden(true)
      Text(phase.rawValue)
        .font(.flareMono(.caption, weight: .semibold))
        .foregroundStyle(FlareColor.text1)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(tint.opacity(0.16), in: Capsule())
    .overlay(Capsule().strokeBorder(tint.opacity(0.4), lineWidth: 1))
  }

  private var tint: Color {
    switch phase {
    case .live: return FlareColor.ok
    case .idle, .ended: return FlareColor.text3
    case .ending: return FlareColor.shutdown
    default: return FlareColor.warn
    }
  }
}

/// Label/value row; stacks vertically at accessibility text sizes.
private struct InfoRow: View {
  let label: String
  let value: String
  let warn: Bool
  let mono: Bool
  @ScaledMetric(relativeTo: .subheadline) private var labelWidth = flareLabelColumn
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  init(_ label: String, _ value: String, warn: Bool = false, mono: Bool = false) {
    self.label = label
    self.value = value
    self.warn = warn
    self.mono = mono
  }

  var body: some View {
    let layout = dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: FlareSpace.xxs))
      : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: FlareSpace.sm))
    layout {
      Text(label)
        .font(.subheadline)
        .foregroundStyle(FlareColor.text2)
        .frame(width: dynamicTypeSize.isAccessibilitySize ? nil : labelWidth, alignment: .leading)
      HStack(alignment: .firstTextBaseline, spacing: FlareSpace.xxs) {
        if warn {
          Image(systemName: "exclamationmark.triangle.fill")
            .font(.caption)
            .accessibilityHidden(true)
        }
        Text(value)
          .font(mono ? .flareMono(.subheadline) : .subheadline.weight(.medium))
          .fixedSize(horizontal: false, vertical: true)
      }
      .foregroundStyle(warn ? FlareColor.warn : FlareColor.text1)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .accessibilityElement(children: .combine)
  }
}

private struct LabeledField<Field: View>: View {
  let title: String
  let field: Field

  init(_ title: String, @ViewBuilder field: () -> Field) {
    self.title = title
    self.field = field()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: FlareSpace.xs) {
      Text(title)
        .font(.footnote.weight(.medium))
        .foregroundStyle(FlareColor.text2)
        .accessibilityHidden(true)
      field
        .textFieldStyle(.plain)
        .font(.flareMono(.callout))
        .foregroundStyle(FlareColor.text1)
        .flareFieldBackground()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct TranscriptLine: View {
  let line: FlareLiveController.Line

  var body: some View {
    switch line.role {
    case .system:
      Text(line.text)
        .font(.footnote)
        .foregroundStyle(FlareColor.text3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    case .gemini:
      bubble(fill: FlareColor.leak.opacity(0.24), alignment: .leading)
    case .tech:
      bubble(fill: FlareColor.control, alignment: .trailing)
    }
  }

  private func bubble(fill: Color, alignment: Alignment) -> some View {
    Text(line.text)
      .font(.callout)
      .foregroundStyle(FlareColor.text1)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, FlareSpace.sm)
      .padding(.vertical, FlareSpace.xs)
      .background(fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .frame(maxWidth: .infinity, alignment: alignment)
      .padding(alignment == .trailing ? .leading : .trailing, FlareSpace.xl)
  }
}

extension String {
  fileprivate func ifBlank(_ fallback: String) -> String { isEmpty ? fallback : self }
}
