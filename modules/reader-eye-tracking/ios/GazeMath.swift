import Foundation

// Camera-space geometry and calibration have no ARKit or UI dependency so the
// numerical contract can be exercised on a host machine as well as an iPhone.
struct GazePoint: Equatable {
  let x: Double
  let y: Double
  var isFinite: Bool { x.isFinite && y.isFinite }
  func distance(to other: GazePoint) -> Double { hypot(x - other.x, y - other.y) }
}

struct GazeVector3 {
  let x: Double
  let y: Double
  let z: Double
  var isFinite: Bool { x.isFinite && y.isFinite && z.isFinite }
}

struct GazeHeadPose {
  let position: GazeVector3
  let forward: GazeVector3

  func differsSignificantly(from reference: GazeHeadPose) -> Bool {
    let distance = sqrt(pow(position.x - reference.position.x, 2) + pow(position.y - reference.position.y, 2) + pow(position.z - reference.position.z, 2))
    let dot = forward.x * reference.forward.x + forward.y * reference.forward.y + forward.z * reference.forward.z
    return distance > 0.07 || dot < cos(15 * Double.pi / 180)
  }
}

enum GazeGeometry {
  // ARFaceAnchor eye transforms point along local POSITIVE Z. The plane is
  // camera z=0, not a projection onto the camera image. Calibration accounts for
  // the physical offset between the camera and display and portrait axes.
  static func displayPlaneIntersection(origin: GazeVector3, direction: GazeVector3) -> GazePoint? {
    guard origin.isFinite, direction.isFinite, abs(direction.z) > 1e-8 else { return nil }
    let distance = -origin.z / direction.z
    guard distance > 0, distance.isFinite else { return nil }
    let point = GazePoint(x: origin.x + distance * direction.x, y: origin.y + distance * direction.y)
    return point.isFinite ? point : nil
  }

  static func median(_ values: [Double]) -> Double? {
    let sorted = values.filter(\.isFinite).sorted()
    guard !sorted.isEmpty else { return nil }
    let middle = sorted.count / 2
    return sorted.count.isMultiple(of: 2) ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  }

  static func medianPoint(_ points: [GazePoint]) -> GazePoint? {
    guard let x = median(points.map(\.x)), let y = median(points.map(\.y)) else { return nil }
    return GazePoint(x: x, y: y)
  }
}

struct GazeCalibrationPair {
  let raw: GazePoint
  let target: GazePoint
}

struct GazeAffineCalibration {
  let origin: GazePoint
  let scale: GazePoint
  let xCoefficients: [Double]
  let yCoefficients: [Double]

  func map(_ point: GazePoint) -> GazePoint? {
    guard point.isFinite else { return nil }
    let basis = [1, (point.x - origin.x) / scale.x, (point.y - origin.y) / scale.y]
    let mapped = GazePoint(
      x: zip(basis, xCoefficients).reduce(0) { $0 + $1.0 * $1.1 },
      y: zip(basis, yCoefficients).reduce(0) { $0 + $1.0 * $1.1 }
    )
    // Deliberately not clamped: off-screen gaze must not masquerade as an edge word.
    return mapped.isFinite ? mapped : nil
  }

  static func fit(_ pairs: [GazeCalibrationPair]) -> GazeAffineCalibration? {
    guard pairs.count >= 6, pairs.allSatisfy({ $0.raw.isFinite && $0.target.isFinite }),
          let center = GazeGeometry.medianPoint(pairs.map(\.raw)) else { return nil }
    let sx = sqrt(pairs.reduce(0) { $0 + pow($1.raw.x - center.x, 2) } / Double(pairs.count))
    let sy = sqrt(pairs.reduce(0) { $0 + pow($1.raw.y - center.y, 2) } / Double(pairs.count))
    guard sx.isFinite, sy.isFinite, sx > 1e-6, sy > 1e-6 else { return nil }
    let basis = pairs.map { [1.0, ($0.raw.x - center.x) / sx, ($0.raw.y - center.y) / sy] }
    var weights = Array(repeating: 1.0, count: pairs.count)
    var model: GazeAffineCalibration?
    // Huber reweighting prevents a single poorly fixated target dominating fit.
    for _ in 0..<5 {
      var matrix = Array(repeating: Array(repeating: 0.0, count: 3), count: 3)
      var xRHS = Array(repeating: 0.0, count: 3)
      var yRHS = xRHS
      for i in pairs.indices {
        for row in 0..<3 {
          xRHS[row] += weights[i] * basis[i][row] * pairs[i].target.x
          yRHS[row] += weights[i] * basis[i][row] * pairs[i].target.y
          for column in 0..<3 { matrix[row][column] += weights[i] * basis[i][row] * basis[i][column] }
        }
      }
      guard let x = solve(matrix, xRHS), let y = solve(matrix, yRHS) else { return nil }
      let candidate = GazeAffineCalibration(origin: center, scale: GazePoint(x: sx, y: sy), xCoefficients: x, yCoefficients: y)
      let residuals = pairs.map { candidate.map($0.raw)!.distance(to: $0.target) }
      let delta = max(0.008, (GazeGeometry.median(residuals) ?? 0) * 1.5)
      weights = residuals.map { $0 <= delta ? 1 : delta / $0 }
      model = candidate
    }
    return model
  }

  // Validation fixations are supplied separately; they never alter the model.
  func validationError(_ pairs: [GazeCalibrationPair]) -> Double? {
    guard !pairs.isEmpty else { return nil }
    let errors = pairs.compactMap { pair in map(pair.raw)?.distance(to: pair.target) }
    guard errors.count == pairs.count else { return nil }
    return GazeGeometry.median(errors)
  }

  private static func solve(_ coefficients: [[Double]], _ rhs: [Double]) -> [Double]? {
    var matrix = zip(coefficients, rhs).map { $0 + [$1] }
    for column in 0..<3 {
      guard let pivot = (column..<3).max(by: { abs(matrix[$0][column]) < abs(matrix[$1][column]) }),
            abs(matrix[pivot][column]) > 1e-9 else { return nil }
      matrix.swapAt(column, pivot)
      let divisor = matrix[column][column]
      for j in column..<4 { matrix[column][j] /= divisor }
      for row in 0..<3 where row != column {
        let factor = matrix[row][column]
        for j in column..<4 { matrix[row][j] -= factor * matrix[column][j] }
      }
    }
    let solution = matrix.map { $0[3] }
    return solution.allSatisfy(\.isFinite) ? solution : nil
  }
}
