/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

//
// MainAppView.swift
//
// Central navigation hub that displays different views based on DAT SDK registration and device states.
// When unregistered, shows the registration flow. When registered, shows the Flare glasses Live call,
// with the original DAT feasibility screen one tap away. Only one of the two exists at a time, so they
// never hold a DeviceSession at once.
//

import MWDATCore
import SwiftUI

struct MainAppView: View {
  let wearables: WearablesInterface
  var viewModel: WearablesViewModel
  /// The POC's UI tests (`--ui-testing`) exercise the diagnostics screen; `--flare-live` opts them back in.
  @State private var showDiagnostics: Bool = {
    let args = ProcessInfo.processInfo.arguments
    return args.contains("--ui-testing") && !args.contains("--flare-live")
  }()

  var body: some View {
    if viewModel.registrationState == .registered {
      if showDiagnostics {
        CameraView(wearables: wearables, wearablesVM: viewModel)
          .safeAreaInset(edge: .top, spacing: 0) {
            Button { showDiagnostics = false } label: {
              Label("Flare Live", systemImage: "chevron.left")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(FlareColor.accent)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, FlareSpace.md)
            .background(.black)
          }
      } else {
        FlareLiveView(wearables: wearables, wearablesVM: viewModel) { showDiagnostics = true }
      }
    } else {
      // User not registered - show registration/onboarding flow
      HomeScreenView(viewModel: viewModel)
    }
  }
}
