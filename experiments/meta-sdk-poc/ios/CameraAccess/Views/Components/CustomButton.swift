/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

//
// CustomButton.swift
//
// Reusable button component used throughout the CameraAccess app for consistent styling.
//

import SwiftUI

struct CustomButton: View {
  let title: String
  let style: ButtonStyle
  let isDisabled: Bool
  let action: () -> Void

  enum ButtonStyle {
    case primary, destructive

    var flareKind: FlareButtonStyle.Kind {
      switch self {
      case .primary:
        return .primary
      case .destructive:
        return .destructive
      }
    }
  }

  var body: some View {
    Button(action: action) {
      Text(title)
    }
    .buttonStyle(FlareButtonStyle(kind: style.flareKind))
    .disabled(isDisabled)
  }
}
