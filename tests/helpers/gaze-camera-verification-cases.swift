func check(_ condition: @autoclosure () -> Bool, _ message: String) {
  if !condition() { fatalError(message) }
}

let startedAt = Date(timeIntervalSince1970: 1_800_000_000)
var camera = GazeCameraVerification(sessionId: "reader-A", runStartedTimestamp: 100, now: startedAt)
check(camera.state == "checking" && camera.depthFrameCount == 0, "Capabilities alone never verify capture")
check(!camera.observe(depthTimestamp: 101, frameTimestamp: 101, width: 640, height: 480), "Unselected camera cannot verify depth")
camera.selectCamera(type: "RGB", isTrueDepth: false, timestamp: 100, now: startedAt)
check(camera.state == "unavailable", "RGB-only configuration must be unavailable")
check(!camera.observe(depthTimestamp: 101, frameTimestamp: 101, width: 640, height: 480), "RGB configuration cannot claim TrueDepth proof")

camera.selectCamera(type: "AVCaptureDeviceTypeBuiltInTrueDepthCamera", isTrueDepth: true, timestamp: 100, now: startedAt)
let initialStatusKey = camera.statusKey
for (depth, frame, width, height) in [
  (99.9, 100.1, 640, 480), // Previous run's data.
  (100.1, 99.9, 640, 480), // Previous run's image frame.
  (Double.nan, 100.1, 640, 480),
  (100.1, Double.infinity, 640, 480),
  (100.1, 100.1, 0, 480),
  (100.1, 100.1, 640, -1),
  (102.0, 101.0, 640, 480), // Future depth timestamp.
  (100.1, 101.0, 640, 480)  // Stale depth reused by a later frame.
] {
  check(!camera.observe(depthTimestamp: depth, frameTimestamp: frame, width: width, height: height), "Reject invalid depth metadata")
}
check(camera.depthFrameCount == 0 && camera.state == "checking", "Invalid samples do not count")
check(camera.observe(depthTimestamp: 101, frameTimestamp: 101.02, width: 640, height: 480), "Save first live observation")
check(camera.depthFrameCount == 1 && camera.state == "checking", "Require a stream rather than one observation")
check(camera.statusKey == initialStatusKey, "A count alone does not trigger bridge traffic")
check(!camera.observe(depthTimestamp: 101, frameTimestamp: 101.04, width: 640, height: 480), "Do not count repeated depth timestamps")
check(!camera.observe(depthTimestamp: 100.9, frameTimestamp: 101.04, width: 640, height: 480), "Do not count out-of-order timestamps")
check(!camera.observe(depthTimestamp: 101.033, frameTimestamp: 101.05, width: 640, height: 480), "No persistence for ordinary second frame")
check(camera.observe(depthTimestamp: 101.066, frameTimestamp: 101.08, width: 640, height: 480), "Persist verification checkpoint")
check(camera.depthFrameCount == 3 && camera.state == "verified", "Three distinct live depth observations verify the run")
let verifiedKey = camera.statusKey
check(verifiedKey != initialStatusKey, "Verification emits a status change")
check(!camera.observe(depthTimestamp: 101.099, frameTimestamp: 101.12, width: 640, height: 480), "Do not persist every subsequent frame")
check(camera.statusKey == verifiedKey, "Count changes do not flood status events")
camera.markUnavailable()
check(camera.state == "verified", "Pause retains proof observed during this run")

let record = camera.persistedValue(captureActive: false, now: startedAt.addingTimeInterval(2))
let json = try JSONSerialization.data(withJSONObject: record, options: .sortedKeys)
check(json.count < 1024, "Diagnostic record remains bounded")
check(record["captureActive"] as? Bool == false, "Record distinguishes stopped capture from historical proof")
check(record["depthFrameCount"] as? Int == 4, "Record contains distinct frame count")
check(record["firstDepthTimestamp"] as? Double == 101 && record["lastDepthTimestamp"] as? Double == 101.099, "Record contains proof interval")
check(Set(record.keys) == Set(["state", "cameraType", "depthFrameCount", "depthWidth", "depthHeight", "schemaVersion", "sessionId", "runId", "runStartedAt", "runStartedTimestamp", "captureActive", "updatedAt", "observedAt", "firstDepthTimestamp", "lastDepthTimestamp"]), "Persist only the agreed sensor metadata")

let previousRun = camera.runId
camera = GazeCameraVerification(sessionId: "reader-A", runStartedTimestamp: 200)
check(camera.runId != previousRun && camera.depthFrameCount == 0 && camera.state == "checking", "Restarting same reader session requires new live proof")
check(camera.firstDepthTimestamp == nil && camera.lastDepthTimestamp == nil && camera.observedAt == nil, "No stale run evidence survives")
check(camera.statusValue["depthWidth"] == nil && camera.statusValue["depthHeight"] == nil, "No stale dimensions survive")
camera.selectCamera(type: "AVCaptureDeviceTypeBuiltInTrueDepthCamera", isTrueDepth: true, timestamp: 200)
check(!camera.observe(depthTimestamp: 101.132, frameTimestamp: 200.1, width: 640, height: 480), "Old capture cannot verify restarted camera")
camera.markUnavailable()
check(camera.state == "unavailable", "Stopped capture without proof is not verified")
print("Gaze camera verification cases passed")
