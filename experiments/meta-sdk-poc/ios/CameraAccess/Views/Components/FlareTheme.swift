/*
 * Copyright (c) 2026 Avon Night Shift / HackUTD-26
 *
 * Native design tokens for Flare, mirrored from the web console's dark instrument band
 * (`.band-dark` in src/app/tokens.css): charcoal surfaces, paper text, one tangerine action
 * colour, mono numerics and an 8-point spacing scale.
 */

import SwiftUI
import UIKit

// MARK: - Spacing and shape

enum FlareSpace {
  static let xxs: CGFloat = 4
  static let xs: CGFloat = 8
  static let sm: CGFloat = 12
  static let md: CGFloat = 16
  static let lg: CGFloat = 24
  static let xl: CGFloat = 32
}

enum FlareRadius {
  static let control: CGFloat = 12
  static let card: CGFloat = 16
  static let media: CGFloat = 20
}

/// Width of the label column in label/value rows; scaled with Dynamic Type at the call site.
let flareLabelColumn: CGFloat = 140

// MARK: - Colour

extension Color {
  fileprivate init(hex: UInt32, opacity: Double = 1) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: opacity
    )
  }
}

enum FlareColor {
  /// One step deeper than the web's `--ink-0` so video and cards lift off the page.
  static let canvas = Color(hex: 0x1F222A)
  static let surface = Color(hex: 0x2B2F3A)
  static let raised = Color(hex: 0x353A47)
  static let control = Color(hex: 0x404656)
  static let line = Color(hex: 0xF3F1EC, opacity: 0.14)

  static let text1 = Color(hex: 0xF6F4EF)
  static let text2 = Color(hex: 0xC9C5BB)
  static let text3 = Color(hex: 0x9A978E)

  static let accent = Color(hex: 0xEE8434)
  static let onAccent = Color(hex: 0x1B1D23)
  static let ok = Color(hex: 0x84B082)
  static let warn = Color(hex: 0xD9A63A)
  static let shutdown = Color(hex: 0xC95D63)
  /// `shutdown` darkened so white labels on it keep 4.5:1.
  static let danger = Color(hex: 0xB4464D)
  /// `shutdown` lightened so red text on cards keeps 4.5:1.
  static let dangerText = Color(hex: 0xE07B81)
  static let leak = Color(hex: 0x4C93A0)
}

// MARK: - Type

/// Display face. The web uses ZT Moven Bold Italic, whose free licence excludes app embedding; it is
/// only picked up if a copy licensed for apps is bundled and listed under `UIAppFonts`.
private struct FlareDisplayFont: ViewModifier {
  private static let licensedFace = "ZTMoven-BoldItalic"
  private static let hasLicensedFace = UIFont(name: licensedFace, size: 12) != nil

  @ScaledMetric private var size: CGFloat

  init(size: CGFloat, relativeTo style: Font.TextStyle) {
    _size = ScaledMetric(wrappedValue: size, relativeTo: style)
  }

  func body(content: Content) -> some View {
    content.font(
      Self.hasLicensedFace
        ? .custom(Self.licensedFace, fixedSize: size)
        : .system(size: size, weight: .bold).italic().width(.expanded)
    )
  }
}

extension View {
  /// Brand and screen titles only; everything read uses the system text styles.
  func flareDisplay(size: CGFloat, relativeTo style: Font.TextStyle) -> some View {
    modifier(FlareDisplayFont(size: size, relativeTo: style))
  }
}

extension Font {
  /// Readings, counts, IDs and URLs. SF Mono stands in for the web's IBM Plex Mono.
  static func flareMono(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
    .system(style, design: .monospaced, weight: weight)
  }
}

// MARK: - Surfaces

extension View {
  func flareCard() -> some View {
    background(FlareColor.surface, in: RoundedRectangle(cornerRadius: FlareRadius.card, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: FlareRadius.card, style: .continuous)
          .strokeBorder(FlareColor.line, lineWidth: 1)
      )
  }

  func flareFieldBackground() -> some View {
    padding(.horizontal, FlareSpace.sm)
      .frame(minHeight: 44)
      .background(FlareColor.raised, in: RoundedRectangle(cornerRadius: FlareRadius.control, style: .continuous))
  }
}

struct FlareDivider: View {
  var body: some View {
    Rectangle().fill(FlareColor.line).frame(height: 1)
  }
}

struct FlareSectionLabel: View {
  let title: String

  init(_ title: String) {
    self.title = title
  }

  var body: some View {
    Text(title)
      .textCase(.uppercase)
      .font(.caption.weight(.semibold))
      .tracking(1)
      .foregroundStyle(FlareColor.text3)
      .accessibilityAddTraits(.isHeader)
  }
}

/// A labelled card: the section label sits above, the content inside a padded surface.
struct FlareSection<Content: View>: View {
  let title: String
  let content: Content

  init(_ title: String, @ViewBuilder content: () -> Content) {
    self.title = title
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: FlareSpace.xs) {
      FlareSectionLabel(title)
      content
        .padding(FlareSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .flareCard()
    }
  }
}

// MARK: - Buttons

struct FlareButtonStyle: ButtonStyle {
  enum Kind { case primary, destructive, secondary }

  let kind: Kind
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(kind == .secondary ? .subheadline.weight(.semibold) : .headline)
      .multilineTextAlignment(.center)
      .foregroundStyle(foreground)
      .padding(.horizontal, FlareSpace.sm)
      .padding(.vertical, FlareSpace.xs)
      .frame(maxWidth: .infinity, minHeight: kind == .secondary ? 44 : 52)
      .background(background, in: RoundedRectangle(cornerRadius: FlareRadius.control, style: .continuous))
      .overlay {
        if kind == .secondary {
          RoundedRectangle(cornerRadius: FlareRadius.control, style: .continuous)
            .strokeBorder(FlareColor.line, lineWidth: 1)
        }
      }
      .contentShape(RoundedRectangle(cornerRadius: FlareRadius.control, style: .continuous))
      .opacity(configuration.isPressed ? 0.8 : 1)
  }

  private var foreground: Color {
    guard isEnabled else { return FlareColor.text3 }
    switch kind {
    case .primary: return FlareColor.onAccent
    case .destructive: return .white
    case .secondary: return FlareColor.text1
    }
  }

  private var background: Color {
    guard isEnabled else { return FlareColor.raised }
    switch kind {
    case .primary: return FlareColor.accent
    case .destructive: return FlareColor.danger
    case .secondary: return FlareColor.raised
    }
  }
}

/// Full-width list row inside a card (tools, links). Destructive rows read red.
struct FlareRowButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.body)
      .foregroundStyle(configuration.role == .destructive ? FlareColor.dangerText : FlareColor.text1)
      .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
      .contentShape(Rectangle())
      .opacity(isEnabled ? (configuration.isPressed ? 0.6 : 1) : 0.4)
  }
}
