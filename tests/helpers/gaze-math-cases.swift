func check(_ value: @autoclosure () -> Bool, _ message: String) { precondition(value(), message) }
func near(_ actual: Double, _ expected: Double, tolerance: Double = 1e-8) -> Bool { abs(actual - expected) <= tolerance }

let origin = GazeVector3(x: 0.02, y: -0.03, z: -0.4)
let ray = GazeGeometry.displayPlaneIntersection(origin: origin, direction: GazeVector3(x: 0.1, y: -0.2, z: 1))!
check(near(ray.x, 0.06) && near(ray.y, -0.11), "Positive eye Z intersects camera display plane without axis mirroring")
let scaledRay = GazeGeometry.displayPlaneIntersection(origin: origin, direction: GazeVector3(x: 0.3, y: -0.6, z: 3))!
check(ray.distance(to: scaledRay) < 1e-8, "Ray intersection is independent of direction scale")
check(GazeGeometry.displayPlaneIntersection(origin: origin, direction: GazeVector3(x: 1, y: 0, z: 0)) == nil, "Parallel rays are rejected")
check(GazeGeometry.displayPlaneIntersection(origin: origin, direction: GazeVector3(x: 1, y: 0, z: 1e-10)) == nil, "Nearly parallel rays are rejected")
check(GazeGeometry.displayPlaneIntersection(origin: origin, direction: GazeVector3(x: 0, y: 0, z: -1)) == nil, "Backward rays do not create screen points")
check(GazeGeometry.displayPlaneIntersection(origin: GazeVector3(x: .nan, y: 0, z: -0.4), direction: GazeVector3(x: 0, y: 0, z: 1)) == nil, "Invalid origins are rejected")
check(GazeGeometry.displayPlaneIntersection(origin: origin, direction: GazeVector3(x: 0, y: .infinity, z: 1)) == nil, "Infinite directions are rejected")
check(GazeGeometry.median([1, 2, 100, 3, .nan]) == 2.5, "Median rejects nonfinite observations")

func target(_ raw: GazePoint) -> GazePoint {
  GazePoint(x: 0.5 + 4 * raw.x - raw.y, y: 0.4 + 0.5 * raw.x + 3 * raw.y)
}
let training: [GazeCalibrationPair] = [-0.08, 0, 0.08].flatMap { x in
  [-0.09, 0, 0.09].map { y in
    let raw = GazePoint(x: x, y: y)
    return GazeCalibrationPair(raw: raw, target: target(raw))
  }
}
let model = GazeAffineCalibration.fit(training)!
let holdout = [GazePoint(x: -0.04, y: 0.06), GazePoint(x: 0.05, y: -0.07), GazePoint(x: 0.03, y: 0.02)].map {
  GazeCalibrationPair(raw: $0, target: target($0))
}
check(model.validationError(holdout)! < 1e-8, "Affine coefficients generalize to independent coordinates")
let biasedHoldout = holdout.map { GazeCalibrationPair(raw: $0.raw, target: GazePoint(x: $0.target.x + 0.06, y: $0.target.y + 0.08)) }
check(near(model.validationError(biasedHoldout)!, 0.1), "Validation error measures independent fixation error rather than training residual")
check(model.validationError(holdout)! < 1e-8, "Validation does not refit the coefficients")
check(model.validationError([]) == nil, "Absent validation observations do not report perfect accuracy")
let offscreen = model.map(GazePoint(x: 1, y: 1))!
check(offscreen.x > 1 && offscreen.y > 1, "Off-screen coordinates are not clamped to edge words")
check(model.map(GazePoint(x: .nan, y: 1)) == nil, "Nonfinite raw samples are rejected")

let repeated = Array(repeating: GazeCalibrationPair(raw: GazePoint(x: 0, y: 0), target: GazePoint(x: 0.5, y: 0.5)), count: 9)
check(GazeAffineCalibration.fit(repeated) == nil, "Nonvarying fixations cannot produce a valid calibration")
let collinear = (0..<9).map { value -> GazeCalibrationPair in
  let raw = GazePoint(x: Double(value) * 0.01, y: Double(value) * 0.02)
  return GazeCalibrationPair(raw: raw, target: target(raw))
}
check(GazeAffineCalibration.fit(collinear) == nil, "Rank-deficient calibration is rejected")
check(GazeAffineCalibration.fit(Array(training.prefix(3))) == nil, "An under-observed fit is rejected")
var invalid = training
invalid[0] = GazeCalibrationPair(raw: GazePoint(x: .infinity, y: 0), target: invalid[0].target)
check(GazeAffineCalibration.fit(invalid) == nil, "Invalid training observations fail instead of poisoning coefficients")
var contaminated = training
let center = contaminated[4]
contaminated[4] = GazeCalibrationPair(raw: center.raw, target: GazePoint(x: center.target.x + 0.7, y: center.target.y - 0.7))
let robust = GazeAffineCalibration.fit(contaminated)!
check(robust.validationError(holdout)! < 0.01, "Robust weighting limits the influence of a badly fixated target")

let reference = GazeHeadPose(position: origin, forward: GazeVector3(x: 0, y: 0, z: 1))
check(!reference.differsSignificantly(from: reference), "Unchanged pose preserves calibration")
let smallShift = GazeHeadPose(position: GazeVector3(x: origin.x + 0.02, y: origin.y, z: origin.z), forward: reference.forward)
check(!smallShift.differsSignificantly(from: reference), "Small handheld movement is tolerated")
let farther = GazeHeadPose(position: GazeVector3(x: origin.x, y: origin.y, z: origin.z - 0.08), forward: reference.forward)
check(farther.differsSignificantly(from: reference), "Substantial viewing-distance drift is detected")
let turn = 20.0 * Double.pi / 180
let rotated = GazeHeadPose(position: origin, forward: GazeVector3(x: sin(turn), y: 0, z: cos(turn)))
check(rotated.differsSignificantly(from: reference), "Substantial head-angle drift is detected")
print("Gaze math cases passed")
