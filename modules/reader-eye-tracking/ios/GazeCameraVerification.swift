import Foundation

// Records sensor metadata only. Never retains or serializes images, depth maps,
// eye measurements, or face anchors. A fresh record is required for every run.
struct GazeCameraVerification {
  private(set) var state = "checking"
  private(set) var cameraType = "unselected"
  private(set) var depthFrameCount = 0
  private(set) var depthWidth: Int?
  private(set) var depthHeight: Int?
  private(set) var firstDepthTimestamp: Double?
  private(set) var lastDepthTimestamp: Double?
  private(set) var observedAt: Date?
  private(set) var runStartedTimestamp: Double
  private(set) var runStartedAt: Date
  let runId: String
  let sessionId: String
  private var trueDepthSelected = false

  init(sessionId: String, runStartedTimestamp: Double, now: Date = Date()) {
    self.sessionId = sessionId
    self.runId = UUID().uuidString
    self.runStartedTimestamp = runStartedTimestamp
    self.runStartedAt = now
  }

  mutating func selectCamera(type: String, isTrueDepth: Bool, timestamp: Double, now: Date = Date()) {
    cameraType = type
    trueDepthSelected = isTrueDepth
    state = isTrueDepth ? "checking" : "unavailable"
    runStartedTimestamp = timestamp
    runStartedAt = now
    depthFrameCount = 0
    depthWidth = nil
    depthHeight = nil
    firstDepthTimestamp = nil
    lastDepthTimestamp = nil
    observedAt = nil
  }

  mutating func markUnavailable() {
    // A camera error does not erase evidence already observed in this run.
    if state != "verified" { state = "unavailable" }
  }

  // The caller invokes this only for a nonnil capturedDepthData buffer. Reused
  // depth timestamps, invalid dimensions and stale frames cannot establish proof.
  // Returns true at the first observation and the three-frame verification
  // checkpoint, so the caller can persist bounded evidence at those moments.
  mutating func observe(depthTimestamp: Double, frameTimestamp: Double, width: Int, height: Int, now: Date = Date()) -> Bool {
    guard trueDepthSelected, width > 0, height > 0,
          depthTimestamp.isFinite, frameTimestamp.isFinite,
          depthTimestamp >= runStartedTimestamp,
          frameTimestamp >= runStartedTimestamp,
          depthTimestamp <= frameTimestamp + 0.05,
          frameTimestamp - depthTimestamp <= 0.5,
          lastDepthTimestamp.map({ depthTimestamp > $0 }) ?? true else { return false }
    let firstObservation = depthFrameCount == 0
    if firstObservation { firstDepthTimestamp = depthTimestamp }
    lastDepthTimestamp = depthTimestamp
    observedAt = now
    depthWidth = width
    depthHeight = height
    if depthFrameCount < Int.max { depthFrameCount += 1 }
    if depthFrameCount >= 3 { state = "verified" }
    return firstObservation || depthFrameCount == 3
  }

  var statusValue: [String: Any] {
    var value: [String: Any] = ["state": state, "cameraType": cameraType, "depthFrameCount": depthFrameCount]
    if let depthWidth { value["depthWidth"] = depthWidth }
    if let depthHeight { value["depthHeight"] = depthHeight }
    return value
  }

  // Count changes are deliberately excluded: metadata must not turn status
  // notifications into per-frame bridge traffic.
  var statusKey: String { "\(runId)|\(state)|\(cameraType)" }

  func persistedValue(captureActive: Bool, now: Date = Date()) -> [String: Any] {
    let dates = ISO8601DateFormatter()
    var value = statusValue
    value["schemaVersion"] = 1
    value["sessionId"] = sessionId
    value["runId"] = runId
    value["runStartedAt"] = dates.string(from: runStartedAt)
    value["runStartedTimestamp"] = runStartedTimestamp
    value["captureActive"] = captureActive
    value["updatedAt"] = dates.string(from: now)
    if let observedAt { value["observedAt"] = dates.string(from: observedAt) }
    if let firstDepthTimestamp { value["firstDepthTimestamp"] = firstDepthTimestamp }
    if let lastDepthTimestamp { value["lastDepthTimestamp"] = lastDepthTimestamp }
    return value
  }
}
