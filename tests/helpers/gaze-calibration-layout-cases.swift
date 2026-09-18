func check(_ value: @autoclosure () -> Bool, _ message: String) { precondition(value(), message) }
func near(_ actual: Double, _ expected: Double) -> Bool { abs(actual - expected) < 1e-8 }

func layout(x: Double = 0, y: Double = 59, width: Double = 430, height: Double = 839, font: Double = 24, scale: Double = 1) -> GazeCalibrationLayout {
  GazeCalibrationLayout(readerX: x, readerY: y, readerWidth: width, readerHeight: height, fontSize: font, fontScale: scale, foreground: "#292929", background: "#FFF9EE")
}
func resolve(_ input: GazeCalibrationLayout, minimumY: Double = 160, maximumY: Double = 780) -> GazeCalibrationGeometry? {
  input.geometry(windowWidth: 430, windowHeight: 932, minimumY: minimumY, maximumY: maximumY)
}

let regular = resolve(layout())!
check(regular.rowCenters.count == 5, "Five visible rows define the reading region")
check(regular.training.count == 9 && regular.validation.count == 5, "Nine training and five independent validation fixations keep the existing duration")
check(near(regular.textX, 30) && near(regular.textWidth, 370), "Calibration matches the reader's horizontal margins")
let expectedCenter = 59.0 + (839.0 + 70.0 - 76.0) / 2
check(near(regular.rowCenters[2], expectedCenter), "The row block is centered in the padded reader viewport")
check(regular.targets.allSatisfy { $0.x > regular.textX && $0.x < regular.textX + regular.textWidth }, "All fixations lie within the text width")
check(regular.training.allSatisfy { !regular.validation.contains($0) }, "Validation coordinates never reuse training coordinates")
check(Set(regular.training.map(\.y)).count == 5 && Set(regular.validation.map(\.y)).count == 5, "Both phases sample every row")
check(regular.targetDiameter < regular.lineHeight, "The target never overlaps the adjacent reading line")

for font in [18.0, 24.0, 32.0] {
  for scale in [1.0, 1.2, 1.5] {
    let result = resolve(layout(font: font, scale: scale))!
    let expectedSpacing = (font * 1.52).rounded() * scale
    for i in 1..<result.rowCenters.count {
      check(near(result.rowCenters[i] - result.rowCenters[i - 1], expectedSpacing), "Rows use the same rounded and scaled line height as reader text")
    }
    check(near(result.rowCenters[2], expectedCenter), "Font changes preserve the reader's vertical center")
    check(result.targetDiameter < expectedSpacing, "Targets remain separate at every supported font size")
  }
}

let shifted = resolve(layout(x: 20, y: 79, width: 390, height: 799))!
check(near(shifted.textX, 50) && near(shifted.textWidth, 330), "Window-coordinate reader offsets are retained")
check(near(shifted.rowCenters[2], expectedCenter), "An inset reader's vertical geometry is derived from its measured viewport")
let wide = layout(width: 1000).geometry(windowWidth: 1000, windowHeight: 932, minimumY: 160, maximumY: 780)!
check(near(wide.textWidth, 700) && near(wide.textX, 150), "Large viewports preserve the paragraph's centered maximum width")

let constrained = resolve(layout(), minimumY: 440, maximumY: 700)!
check(constrained.rowCenters[2] > regular.rowCenters[2], "Heading overlap shifts the whole block only when needed")
check(near(constrained.rowCenters[1] - constrained.rowCenters[0], regular.lineHeight), "Chrome constraints never compress line spacing")
check(constrained.rowCenters.first! - constrained.lineHeight / 2 >= 440, "Shifted rows stay clear of the instructions")
check(resolve(layout(), minimumY: 500, maximumY: 600) == nil, "Insufficient calibration space is rejected instead of collapsing targets")
check(resolve(layout(width: 140)) == nil, "Tiny text widths are rejected")
check(resolve(layout(height: 190)) == nil, "Tiny text heights are rejected")
check(resolve(layout(x: .nan)) == nil, "Nonfinite coordinates are rejected")
check(resolve(layout(font: .infinity)) == nil, "Nonfinite typography is rejected")
check(resolve(layout(scale: 0)) == nil, "Invalid font scaling is rejected")
check(resolve(layout(width: 450)) == nil, "Stale viewport dimensions exceeding the window are rejected")
check(resolve(layout(), minimumY: .nan) == nil, "Invalid overlay boundaries are rejected")

// Fit known synthetic measurements at the production row positions, then check
// new points. A row design must provide enough two-dimensional information.
func raw(_ target: GazePoint) -> GazePoint {
  GazePoint(x: (target.x - 200) / 2000, y: (target.y - 475) / 1800)
}
let training = regular.training.map { GazeCalibrationPair(raw: raw($0), target: GazePoint(x: $0.x / 430, y: $0.y / 932)) }
let validation = regular.validation.map { GazeCalibrationPair(raw: raw($0), target: GazePoint(x: $0.x / 430, y: $0.y / 932)) }
let model = GazeAffineCalibration.fit(training)!
check(model.validationError(validation)! < 1e-8, "The reader-region target geometry supports a nonsingular affine fit and independent validation")
print("Gaze calibration layout cases passed")
