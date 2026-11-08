/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

//
// HomeScreenView.swift
//
// Welcome screen that guides users through the DAT SDK registration process.
// This view is displayed when the app is not yet registered.
//

import MWDATCore
import SwiftUI

struct HomeScreenView: View {
  var viewModel: WearablesViewModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: FlareSpace.xl) {
        VStack(alignment: .leading, spacing: FlareSpace.xs) {
          Text("Avon Night Shift")
            .textCase(.uppercase)
            .font(.caption.weight(.semibold))
            .tracking(1)
            .foregroundStyle(FlareColor.accent)
          Text("Flare")
            .flareDisplay(size: 44, relativeTo: .largeTitle)
            .foregroundStyle(FlareColor.text1)
            .accessibilityAddTraits(.isHeader)
          Text("Hands-free field calls through your Meta glasses.")
            .font(.title3)
            .foregroundStyle(FlareColor.text2)
            .fixedSize(horizontal: false, vertical: true)
        }

        VStack(alignment: .leading, spacing: FlareSpace.lg) {
          TipRow(
            resource: .smartGlassesIcon,
            title: "Connect your glasses",
            text: "Pair once through the Meta AI app."
          )
          TipRow(
            resource: .videoIcon,
            title: "Go live",
            text: "Gemini sees what your glasses see and talks you through the job."
          )
          TipRow(
            resource: .tapIcon,
            title: "Stay hands-free",
            text: "Once the call is live you never need to touch the phone."
          )
        }
        .padding(FlareSpace.lg)
        .flareCard()
      }
      .padding(.horizontal, FlareSpace.lg)
      .padding(.top, FlareSpace.xl + FlareSpace.md)
      .padding(.bottom, FlareSpace.lg)
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(spacing: FlareSpace.md) {
        Text("You'll be redirected to the Meta AI app to confirm your connection.")
          .font(.footnote)
          .foregroundStyle(FlareColor.text3)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)

        CustomButton(
          title: viewModel.registrationState == .registering ? "Connecting…" : "Connect my glasses",
          style: .primary,
          isDisabled: viewModel.registrationState == .registering
        ) {
          viewModel.connectGlasses()
        }

        Text("© 2026 Avon Corps")
          .font(.caption2)
          .foregroundStyle(FlareColor.text3)
      }
      .padding(.horizontal, FlareSpace.lg)
      .padding(.top, FlareSpace.md)
      .padding(.bottom, FlareSpace.xs)
      .background(FlareColor.canvas.ignoresSafeArea(edges: .bottom))
    }
    .background(FlareColor.canvas.ignoresSafeArea())
    .preferredColorScheme(.dark)
  }
}
