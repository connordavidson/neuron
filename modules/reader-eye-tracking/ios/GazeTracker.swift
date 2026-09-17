import ARKit
import AVFoundation
import UIKit
import QuartzCore
import simd

struct GazeSample {
  let sessionId: String
  let timestamp: Double
  let x: Double?
  let y: Double?
  let quality: String
  let validationError: Double
}

// One camera owner, serialized on main. Frames never cross the React bridge;
// only status changes and the native passage view's selected word do.
final class GazeTracker: NSObject, ARSessionDelegate {
  static let shared = GazeTracker()
  var onStatus: (([String: Any]) -> Void)?
  private var arSession = ARSession()
  private var observers: [UUID: (GazeSample) -> Void] = [:]
  private var sessionId: String?
  private var epoch = 0
  private var running = false
  private var interrupted = false
  private var runStarted = 0.0
  private var lastUsableFrame = 0.0
  private var heartbeat: Timer?
  private var calibration: GazeCalibrationResult?
  private var calibrationController: GazeCalibrationViewController?
  private var calibrationCompletion: ((Result<Void, GazeTrackingError>) -> Void)?
  private var calibrationDismissalInFlight = false
  private var calibrationDismissalWaiters: [() -> Void] = []
  private var driftStarted: Double?
  private var lastStatusKey = ""
  private var notifications: [NSObjectProtocol] = []
  private var pendingAuthorization: (() -> Void)?

  override private init() {
    super.init()
    arSession.delegate = self
    arSession.delegateQueue = .main
    notifications.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      // The camera permission sheet also makes the app inactive. It must not
      // cancel its own pending start before the user can grant access.
      guard let self, self.running, let id = self.sessionId else { return }
      self.pause(id) { _ in }
    })
    notifications.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      let pending = self?.pendingAuthorization
      self?.pendingAuthorization = nil
      pending?()
    })
  }

  static func capabilities() -> [String: Any] {
    #if targetEnvironment(simulator)
    return ["available": false, "reason": "Eye tracking requires a physical TrueDepth iPhone."]
    #else
    guard UIDevice.current.userInterfaceIdiom == .phone else {
      return ["available": false, "reason": "This experimental version supports TrueDepth iPhones."]
    }
    guard ARFaceTrackingConfiguration.isSupported,
          AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front) != nil else {
      return ["available": false, "reason": "Eye tracking requires a TrueDepth front camera."]
    }
    return ["available": true]
    #endif
  }

  func addObserver(id: UUID, handler: @escaping (GazeSample) -> Void) { observers[id] = handler }
  func removeObserver(id: UUID) { observers.removeValue(forKey: id) }

  func start(_ id: String, completion: @escaping (Result<Void, GazeTrackingError>) -> Void) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard !id.isEmpty else { completion(.failure(error("ERR_GAZE_SESSION", "A reader session is required."))); return }
    let capability = Self.capabilities()
    guard capability["available"] as? Bool == true else {
      completion(.failure(error("ERR_GAZE_UNSUPPORTED", capability["reason"] as? String ?? "Eye tracking is unavailable.")))
      return
    }
    guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil else {
      completion(.failure(error("ERR_GAZE_REBUILD", "Rebuild the iOS app to enable eye tracking.")))
      return
    }
    guard UIApplication.shared.applicationState == .active else {
      completion(.failure(error("ERR_GAZE_BACKGROUND", "Return to the reader to start eye tracking.")))
      return
    }
    if sessionId != nil && sessionId != id {
      stop(sessionId!) { [weak self] _ in self?.start(id, completion: completion) }
      return
    }
    sessionId = id
    if running { completion(.success(())); return }
    epoch += 1
    let requestEpoch = epoch
    status(phase: "starting", quality: "unavailable", message: "Starting eye tracking…")
    let authorized: (Bool) -> Void = { [weak self] granted in
      guard let self else { completion(.failure(.cancelled)); return }
      guard self.epoch == requestEpoch, self.sessionId == id else { completion(.failure(.cancelled)); return }
      guard granted else {
        self.status(phase: "error", quality: "unavailable", reason: "permission", message: "Allow camera access in Settings to use eye tracking.")
        completion(.failure(self.error("ERR_GAZE_PERMISSION", "Allow camera access in Settings to use eye tracking.")))
        return
      }
      let begin = { [weak self] in
        guard let self, self.epoch == requestEpoch, self.sessionId == id else { completion(.failure(.cancelled)); return }
        guard UIApplication.shared.applicationState == .active else { completion(.failure(.cancelled)); return }
        self.runSession()
        completion(.success(()))
      }
      if UIApplication.shared.applicationState == .active { begin() }
      else { self.pendingAuthorization = begin }
    }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: authorized(true)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in DispatchQueue.main.async { authorized(granted) } }
    default: authorized(false)
    }
  }

  func pause(_ id: String, completion: @escaping (Result<Void, GazeTrackingError>) -> Void) {
    guard sessionId == id else { completion(.success(())); return }
    epoch += 1
    cancelPendingAuthorization()
    pauseCamera()
    publishInvalid("paused")
    status(phase: "paused", quality: "unavailable", reason: "paused", message: "Eye tracking is paused.")
    dismissCalibration(result: .failure(.cancelled)) { completion(.success(())) }
  }

  func stop(_ id: String, completion: @escaping (Result<Void, GazeTrackingError>) -> Void) {
    guard sessionId == id else { completion(.success(())); return }
    epoch += 1
    interrupted = false
    cancelPendingAuthorization()
    pauseCamera()
    publishInvalid("stopped")
    status(phase: "idle", quality: "unavailable")
    sessionId = nil
    calibration = nil
    driftStarted = nil
    lastStatusKey = ""
    dismissCalibration(result: .failure(.cancelled)) { completion(.success(())) }
  }

  func calibrate(_ id: String, presenter: UIViewController?, completion: @escaping (Result<Void, GazeTrackingError>) -> Void) {
    guard sessionId == id, running else {
      completion(.failure(error("ERR_GAZE_NOT_STARTED", "Start eye tracking before calibration."))); return
    }
    guard calibrationController == nil else {
      completion(.failure(error("ERR_GAZE_CALIBRATION_BUSY", "Eye tracking calibration is already open."))); return
    }
    guard let presenter, presenter.viewIfLoaded?.window != nil,
          !presenter.isBeingDismissed, presenter.presentedViewController == nil else {
      completion(.failure(error("ERR_GAZE_PRESENTATION", "Close the reader panel and try calibrating again."))); return
    }
    let controller = GazeCalibrationViewController()
    controller.modalPresentationStyle = .fullScreen
    calibration = nil
    driftStarted = nil
    calibrationController = controller
    calibrationCompletion = completion
    let calibrationEpoch = epoch
    controller.onResult = { [weak self] result in
      guard let self, self.sessionId == id, self.epoch == calibrationEpoch else { return }
      switch result {
      case .success(let calibration):
        self.calibration = calibration
        self.lastUsableFrame = CACurrentMediaTime()
        self.status(phase: "tracking", quality: calibration.validationError <= 0.05 ? "good" : "low",
                    reason: calibration.validationError <= 0.05 ? nil : "calibration",
                    message: calibration.validationError <= 0.05 ? nil : "Accuracy is limited. Recalibrate if the box is off target.")
        self.dismissCalibration(result: .success(())) {}
      case .failure(let error):
        self.pauseCamera()
        self.publishInvalid("paused")
        self.status(phase: error.code == "ERR_GAZE_CANCELLED" ? "paused" : "error", quality: "unavailable", reason: "calibration", message: error.message)
        self.dismissCalibration(result: .failure(error)) {}
      }
    }
    publishInvalid("calibrating")
    status(phase: "calibrating", quality: "unavailable", message: "Look at each dot to calibrate eye tracking.")
    presenter.present(controller, animated: true)
  }

  func shutdown() {
    if let id = sessionId { stop(id) { _ in } }
    onStatus = nil
  }

  private func runSession() {
    interrupted = false
    // Give every run a fresh delegate identity. A queued failure/interruption
    // from the old camera session must not tear down a newly resumed reader.
    arSession.delegate = nil
    arSession = ARSession()
    arSession.delegate = self
    arSession.delegateQueue = .main
    let configuration = ARFaceTrackingConfiguration()
    configuration.maximumNumberOfTrackedFaces = 1
    configuration.isLightEstimationEnabled = false
    configuration.isWorldTrackingEnabled = false
    runStarted = CACurrentMediaTime()
    lastUsableFrame = runStarted
    running = true
    arSession.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    heartbeat?.invalidate()
    heartbeat = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
      guard let self, self.running, self.calibration != nil, self.calibrationController == nil,
            CACurrentMediaTime() - self.lastUsableFrame > 0.5 else { return }
      self.publishInvalid("lost")
      self.status(phase: "paused", quality: "unavailable", reason: "trackingLost", message: "Tracking paused. Keep your face in view.")
    }
  }

  private func pauseCamera() {
    running = false
    arSession.pause()
    heartbeat?.invalidate()
    heartbeat = nil
  }

  private func cancelPendingAuthorization() {
    let pending = pendingAuthorization
    pendingAuthorization = nil
    // The caller has already advanced epoch; this resolves the old request as
    // cancelled without ever starting capture.
    pending?()
  }

  // Resolves only after UIKit dismissal, so awaiting pause is a camera/presenter
  // handoff barrier for the page scanner rather than a fire-and-forget signal.
  private func dismissCalibration(result: Result<Void, GazeTrackingError>, then: @escaping () -> Void) {
    if calibrationDismissalInFlight {
      calibrationDismissalWaiters.append(then)
      return
    }
    let controller = calibrationController
    let completion = calibrationCompletion
    calibrationController = nil
    calibrationCompletion = nil
    controller?.invalidate()
    let finish = { [weak self] in
      self?.calibrationDismissalInFlight = false
      let waiters = self?.calibrationDismissalWaiters ?? []
      self?.calibrationDismissalWaiters.removeAll()
      completion?(result)
      then()
      waiters.forEach { $0() }
    }
    if let controller, controller.presentingViewController != nil {
      calibrationDismissalInFlight = true
      controller.dismiss(animated: false, completion: finish)
    }
    else { finish() }
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard session === arSession, running, sessionId != nil, frame.timestamp >= runStarted else { return }
    guard let face = frame.anchors.compactMap({ $0 as? ARFaceAnchor }).first, face.isTracked else {
      publishInvalid("lost", timestamp: frame.timestamp); return
    }
    let leftBlink = face.blendShapes[.eyeBlinkLeft]?.doubleValue ?? 0
    let rightBlink = face.blendShapes[.eyeBlinkRight]?.doubleValue ?? 0
    guard leftBlink < 0.55, rightBlink < 0.55 else {
      publishInvalid("blink", timestamp: frame.timestamp); return
    }
    let faceInCamera = simd_inverse(frame.camera.transform) * face.transform
    guard let left = intersection(faceInCamera * face.leftEyeTransform),
          let right = intersection(faceInCamera * face.rightEyeTransform) else {
      publishInvalid("lost", timestamp: frame.timestamp); return
    }
    let raw = GazePoint(x: (left.x + right.x) / 2, y: (left.y + right.y) / 2)
    let translation = faceInCamera.columns.3
    let forwardVector = simd_normalize(SIMD3<Float>(faceInCamera.columns.2.x, faceInCamera.columns.2.y, faceInCamera.columns.2.z))
    let pose = GazeHeadPose(position: GazeVector3(x: Double(translation.x), y: Double(translation.y), z: Double(translation.z)),
                            forward: GazeVector3(x: Double(forwardVector.x), y: Double(forwardVector.y), z: Double(forwardVector.z)))
    guard pose.position.isFinite, pose.forward.isFinite else { publishInvalid("lost", timestamp: frame.timestamp); return }
    if let controller = calibrationController {
      controller.accept(raw: raw, pose: pose, timestamp: frame.timestamp)
      return
    }
    guard let calibration, let point = calibration.model.map(raw), let id = sessionId else { return }
    lastUsableFrame = frame.timestamp
    if pose.differsSignificantly(from: calibration.referencePose) {
      if driftStarted == nil { driftStarted = frame.timestamp }
    } else { driftStarted = nil }
    let drifted = driftStarted.map { frame.timestamp - $0 > 1.0 } ?? false
    let quality = drifted || calibration.validationError > 0.05 ? "low" : "good"
    status(phase: "tracking", quality: quality, reason: drifted ? "poseChanged" : quality == "low" ? "calibration" : nil,
           message: drifted ? "Your viewing position changed. Recalibrate for better accuracy." : quality == "low" ? "Accuracy is limited. Recalibrate if the box is off target." : nil)
    publish(GazeSample(sessionId: id, timestamp: frame.timestamp, x: point.x, y: point.y, quality: quality, validationError: calibration.validationError))
  }

  private func intersection(_ eyeInCamera: simd_float4x4) -> GazePoint? {
    let origin = eyeInCamera.columns.3
    let direction = eyeInCamera.columns.2
    return GazeGeometry.displayPlaneIntersection(
      origin: GazeVector3(x: Double(origin.x), y: Double(origin.y), z: Double(origin.z)),
      direction: GazeVector3(x: Double(direction.x), y: Double(direction.y), z: Double(direction.z)))
  }

  func sessionWasInterrupted(_ session: ARSession) {
    guard session === arSession, running else { return }
    interrupted = true
    epoch += 1
    pauseCamera()
    publishInvalid("interrupted")
    status(phase: "paused", quality: "unavailable", reason: "interrupted", message: "The camera was interrupted. Resume eye tracking when ready.")
    dismissCalibration(result: .failure(error("ERR_GAZE_INTERRUPTED", "The camera was interrupted during calibration."))) {}
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    // Deliberately wait for the reader's eligibility gate to call start again;
    // auto-running here could steal the camera back from the page scanner.
    guard session === arSession, interrupted, sessionId != nil, !running else { return }
    interrupted = false
    status(phase: "paused", quality: "unavailable", reason: "interruptionEnded", message: "The camera is available. Eye tracking can resume.")
  }

  func session(_ session: ARSession, didFailWithError failure: Error) {
    guard session === arSession, running else { return }
    epoch += 1
    pauseCamera()
    publishInvalid("error")
    status(phase: "error", quality: "unavailable", reason: "camera", message: "Eye tracking could not use the camera. Try again.")
    dismissCalibration(result: .failure(error("ERR_GAZE_CAMERA", "Eye tracking could not use the camera. Try again."))) {}
  }

  private func publishInvalid(_ quality: String, timestamp: Double = CACurrentMediaTime()) {
    guard let id = sessionId else { return }
    publish(GazeSample(sessionId: id, timestamp: timestamp, x: nil, y: nil, quality: quality, validationError: calibration?.validationError ?? 1))
  }

  private func publish(_ sample: GazeSample) {
    for callback in Array(observers.values) { callback(sample) }
  }

  private func status(phase: String, quality: String, reason: String? = nil, message: String? = nil) {
    guard let id = sessionId else { return }
    let key = [id, phase, quality, reason ?? "", message ?? ""].joined(separator: "|")
    guard key != lastStatusKey else { return }
    lastStatusKey = key
    var value: [String: Any] = ["sessionId": id, "phase": phase, "quality": quality]
    if let reason { value["reason"] = reason }
    if let message { value["message"] = message }
    if let calibration { value["validationError"] = calibration.validationError }
    onStatus?(value)
  }

  private func error(_ code: String, _ message: String) -> GazeTrackingError { GazeTrackingError(code: code, message: message) }
}
