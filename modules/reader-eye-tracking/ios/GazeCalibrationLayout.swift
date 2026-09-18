import Foundation

// The bridge supplies the measured reader viewport in window points. Keep these
// in sync with readerStyles.page/textPressable/paragraph, so calibration samples
// the same centered lines that a five-line passage would occupy.
struct GazeCalibrationLayout {
  let readerX: Double
  let readerY: Double
  let readerWidth: Double
  let readerHeight: Double
  let fontSize: Double
  let fontScale: Double
  let foreground: String
  let background: String

  func geometry(windowWidth: Double, windowHeight: Double, minimumY: Double, maximumY: Double) -> GazeCalibrationGeometry? {
    let values = [readerX, readerY, readerWidth, readerHeight, fontSize, fontScale, windowWidth, windowHeight, minimumY, maximumY]
    guard values.allSatisfy(\.isFinite), readerWidth > 60, readerHeight > 170,
          fontSize > 0, fontScale > 0, windowWidth > 0, windowHeight > 0,
          readerX >= -1, readerY >= -1,
          readerX + readerWidth <= windowWidth + 1,
          readerY + readerHeight <= windowHeight + 1 else { return nil }

    let lineHeight = (fontSize * 1.52).rounded() * fontScale
    guard lineHeight >= 16, lineHeight.isFinite else { return nil }
    let textWidth = min(700, readerWidth - 60)
    let textX = readerX + (readerWidth - textWidth) / 2
    let textTop = readerY + 70 + 12
    let textBottom = readerY + readerHeight - 76 - 12
    let usableTop = max(textTop, minimumY)
    let usableBottom = min(textBottom, maximumY)
    let blockHeight = lineHeight * 5
    guard textWidth >= 100, usableBottom - usableTop >= blockHeight else { return nil }

    // Keep the reader's center unless the calibration instructions need room.
    // Move the whole block when necessary; never squeeze its actual line spacing.
    let desiredCenter = (textTop + textBottom) / 2
    let centerY = min(max(desiredCenter, usableTop + blockHeight / 2), usableBottom - blockHeight / 2)
    let rows = (0..<5).map { centerY + Double($0 - 2) * lineHeight }
    func point(_ row: Int, _ fraction: Double) -> GazePoint {
      GazePoint(x: textX + fraction * textWidth, y: rows[row])
    }
    let training = [
      point(0, 0.08), point(0, 0.92),
      point(1, 0.5),
      point(2, 0.08), point(2, 0.92),
      point(3, 0.5),
      point(4, 0.08), point(4, 0.5), point(4, 0.92)
    ]
    // New fixations at different coordinates check the fitted mapping. None of
    // these observations are included in the nine-point calibration fit.
    let validation = [point(0, 0.32), point(1, 0.75), point(2, 0.5), point(3, 0.25), point(4, 0.68)]
    return GazeCalibrationGeometry(
      textX: textX, textWidth: textWidth, rowCenters: rows,
      lineHeight: lineHeight, targetDiameter: min(22, lineHeight * 0.65),
      training: training, validation: validation
    )
  }
}

struct GazeCalibrationGeometry: Equatable {
  let textX: Double
  let textWidth: Double
  let rowCenters: [Double]
  let lineHeight: Double
  let targetDiameter: Double
  let training: [GazePoint]
  let validation: [GazePoint]
  var targets: [GazePoint] { training + validation }
}
