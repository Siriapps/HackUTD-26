/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

//
// TipRow.swift
//
// Reusable icon + text row used by the onboarding tips on the home screen and
// the getting-started sheet. Pass a `title` for the two-line (title + body)
// variant; omit it for the single-line body-only variant.
//

import SwiftUI

struct TipRow: View {
  let resource: ImageResource
  var title: String?
  let text: String

  @ScaledMetric(relativeTo: .headline) private var iconSize: CGFloat = 22

  var body: some View {
    HStack(alignment: .top, spacing: FlareSpace.md) {
      Image(resource)
        .resizable()
        .renderingMode(.template)
        .foregroundStyle(FlareColor.accent)
        .aspectRatio(contentMode: .fit)
        .frame(width: iconSize, height: iconSize)
        .frame(width: 40, height: 40)
        .background(FlareColor.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityHidden(true)

      if let title {
        VStack(alignment: .leading, spacing: FlareSpace.xxs) {
          Text(title)
            .font(.headline)
            .foregroundStyle(FlareColor.text1)
          Text(text)
            .font(.subheadline)
            .foregroundStyle(FlareColor.text2)
            .fixedSize(horizontal: false, vertical: true)
        }
      } else {
        Text(text)
          .font(.subheadline)
          .foregroundStyle(FlareColor.text1)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}
