/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

//
// CapturePreviewView.swift
//
// Shared preview/share screen for captures from Meta wearable devices via the
// DAT SDK. Photos (Stream.capturePhoto()) and recorded videos use the same
// chrome — a media view plus Share and Close — so the two flows are consistent
// and captures aren't written straight to the library. Share hands the capture
// to the system share sheet, which includes "Save Image/Video" to Photos.
//

import AVKit
import SwiftUI

struct CapturePreviewView: View {
  let preview: CapturePreview
  let onDismiss: () -> Void

  @State private var player: AVPlayer?
  @State private var showShareSheet = false

  init(preview: CapturePreview, onDismiss: @escaping () -> Void) {
    self.preview = preview
    self.onDismiss = onDismiss
    if case .video(let url) = preview {
      _player = State(initialValue: AVPlayer(url: url))
    }
  }

  var body: some View {
    ZStack {
      Color.black.opacity(0.92)
        .ignoresSafeArea()
        .onTapGesture { dismiss() }

      VStack(spacing: FlareSpace.md) {
        HStack {
          Spacer()
          CircleButton(icon: "xmark", text: nil) {
            dismiss()
          }
          .accessibilityIdentifier("close_preview_button")
        }

        mediaView
          .frame(maxWidth: .infinity, maxHeight: .infinity)

        CircleButton(icon: "square.and.arrow.up", text: "Share") {
          showShareSheet = true
        }
        .accessibilityIdentifier("share_button")
      }
      .padding(.horizontal, FlareSpace.md)
      .padding(.vertical, FlareSpace.xs)
    }
    .onAppear { player?.play() }
    .sheet(isPresented: $showShareSheet) {
      ShareSheet(activityItems: [shareItem])
    }
  }

  /// Fitted to the space between the close and share controls at the media's own aspect ratio;
  /// the player letterboxes video itself.
  @ViewBuilder
  private var mediaView: some View {
    switch preview {
    case .photo(let image):
      Image(uiImage: image)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: FlareRadius.card, style: .continuous))
    case .video:
      if let player {
        VideoPlayer(player: player)
          .clipShape(RoundedRectangle(cornerRadius: FlareRadius.card, style: .continuous))
      }
    }
  }

  private var shareItem: Any {
    switch preview {
    case .photo(let image): return image
    case .video(let url): return url
    }
  }

  private func dismiss() {
    player?.pause()
    onDismiss()
  }
}

struct ShareSheet: UIViewControllerRepresentable {
  let activityItems: [Any]

  func makeUIViewController(context: Context) -> UIActivityViewController {
    let activityViewController = UIActivityViewController(
      activityItems: activityItems,
      applicationActivities: nil
    )

    activityViewController.excludedActivityTypes = [
      .assignToContact,
      .addToReadingList,
    ]

    return activityViewController
  }

  func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
