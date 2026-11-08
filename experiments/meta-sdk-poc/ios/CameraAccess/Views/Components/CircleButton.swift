/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

//
// CircleButton.swift
//
// Reusable circular button component used in streaming controls and UI actions.
//

import SwiftUI

struct CircleButton: View {
  let icon: String
  let text: String?
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      if let text {
        VStack(spacing: 2) {
          Image(systemName: icon)
            .font(.system(size: 16, weight: .semibold))
          Text(text)
            .font(.system(size: 11, weight: .semibold))
        }
      } else {
        Image(systemName: icon)
          .font(.system(size: 17, weight: .semibold))
      }
    }
    .foregroundStyle(FlareColor.onAccent)
    .frame(width: 56, height: 56)
    .background(FlareColor.text1)
    .clipShape(Circle())
  }
}
