import UIKit
import QuartzCore

struct GazeCalibrationResult {
  let model: GazeAffineCalibration
  let validationError: Double
  let referencePose: GazeHeadPose
}

struct GazeTrackingError: LocalizedError {
  let code: String
  let message: String
  var errorDescription: String? { message }
  static let cancelled = GazeTrackingError(code: "ERR_GAZE_CANCELLED", message: "Eye tracking setup was cancelled.")
}

// This UI never shows camera images. Fixation observations live only until fit;
// the tracker retains coefficients, validation error and a reference head pose.
final class GazeCalibrationViewController: UIViewController {
  var onResult: ((Result<GazeCalibrationResult, GazeTrackingError>) -> Void)?
  private let titleLabel = UILabel()
  private let instructionLabel = UILabel()
  private let progressLabel = UILabel()
  private let target = UIView()
  private let dot = UIView()
  private let progress = UIProgressView(progressViewStyle: .default)
  private var timer: Timer?
  private var targetIndex = 0
  private var targetStarted = 0.0
  private var rawSamples: [GazePoint] = []
  private var poses: [GazeHeadPose] = []
  private var pairs: [GazeCalibrationPair] = []
  private var shownTarget = GazePoint(x: 0.5, y: 0.5)
  private var started = false
  private var finished = false
  private let trainingCount = 9
  // These validation fixations are independent observations, never fit data.
  private let targets: [GazePoint] = [
    GazePoint(x: 0.15, y: 0.24), GazePoint(x: 0.5, y: 0.24), GazePoint(x: 0.85, y: 0.24),
    GazePoint(x: 0.85, y: 0.49), GazePoint(x: 0.5, y: 0.49), GazePoint(x: 0.15, y: 0.49),
    GazePoint(x: 0.15, y: 0.75), GazePoint(x: 0.5, y: 0.75), GazePoint(x: 0.85, y: 0.75),
    GazePoint(x: 0.3, y: 0.36), GazePoint(x: 0.7, y: 0.64), GazePoint(x: 0.5, y: 0.49),
    GazePoint(x: 0.7, y: 0.36), GazePoint(x: 0.3, y: 0.64)
  ]

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    isModalInPresentation = true
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    titleLabel.textAlignment = .center
    titleLabel.text = "Calibrate eye tracking"
    instructionLabel.font = .preferredFont(forTextStyle: .subheadline)
    instructionLabel.textAlignment = .center
    instructionLabel.numberOfLines = 3
    instructionLabel.text = "Hold your phone as you read. Look at the center of each dot. About 25 seconds."
    progressLabel.font = .preferredFont(forTextStyle: .footnote)
    progressLabel.textAlignment = .center
    progressLabel.numberOfLines = 2
    let cancel = UIButton(type: .system)
    cancel.setTitle("Cancel", for: .normal)
    cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
    for item in [titleLabel, instructionLabel, progressLabel, progress, cancel] {
      item.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(item)
    }
    NSLayoutConstraint.activate([
      titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
      titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      instructionLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 8),
      instructionLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
      instructionLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
      cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
      cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
      progressLabel.bottomAnchor.constraint(equalTo: cancel.topAnchor, constant: -12),
      progressLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
      progressLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
      progress.bottomAnchor.constraint(equalTo: progressLabel.topAnchor, constant: -12),
      progress.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
      progress.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40)
    ])
    target.bounds = CGRect(x: 0, y: 0, width: 38, height: 38)
    target.layer.cornerRadius = 19
    target.layer.borderWidth = 1.5
    target.layer.borderColor = UIColor.label.cgColor
    target.isUserInteractionEnabled = false
    dot.frame = CGRect(x: 15, y: 15, width: 8, height: 8)
    dot.layer.cornerRadius = 4
    dot.backgroundColor = .label
    target.addSubview(dot)
    view.addSubview(target)
    target.isAccessibilityElement = true
    target.accessibilityLabel = "Look at the center of this dot"
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    showTarget()
    timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.tick() }
  }

  func accept(raw: GazePoint, pose: GazeHeadPose, timestamp: Double) {
    guard started, !finished, timestamp - targetStarted >= 0.55 else { return }
    rawSamples.append(raw)
    poses.append(pose)
  }

  func invalidate() {
    finished = true
    timer?.invalidate()
    timer = nil
    onResult = nil
  }

  @objc private func cancelTapped() { finish(.failure(.cancelled)) }

  private func showTarget() {
    guard targetIndex < targets.count, let window = view.window else {
      finish(.failure(GazeTrackingError(code: "ERR_GAZE_WINDOW", message: "Open the reader again to calibrate eye tracking.")))
      return
    }
    view.layoutIfNeeded()
    let desired = targets[targetIndex]
    // Avoid heading/footer even with larger accessibility text; convert the
    // ACTUAL rendered target back to normalized window coordinates for fitting.
    let minY = instructionLabel.frame.maxY + 28
    let maxY = progress.frame.minY - 28
    target.center = CGPoint(x: view.bounds.width * desired.x, y: min(max(view.bounds.height * desired.y, minY), maxY))
    let windowPoint = view.convert(target.center, to: window)
    shownTarget = GazePoint(x: Double(windowPoint.x / window.bounds.width), y: Double(windowPoint.y / window.bounds.height))
    rawSamples.removeAll(keepingCapacity: true)
    targetStarted = CACurrentMediaTime()
    titleLabel.text = targetIndex < trainingCount ? "Calibrate eye tracking" : "Check eye tracking"
    progressLabel.text = "Dot \(targetIndex + 1) of \(targets.count)"
    progress.setProgress(Float(targetIndex) / Float(targets.count), animated: true)
  }

  private func tick() {
    guard !finished else { return }
    let elapsed = CACurrentMediaTime() - targetStarted
    guard elapsed >= 1.75 else { return }
    guard rawSamples.count >= 12, let raw = GazeGeometry.medianPoint(rawSamples) else {
      progressLabel.text = "Keep your eyes open and your face in view."
      if elapsed > 4 {
        finish(.failure(GazeTrackingError(code: "ERR_GAZE_CALIBRATION_SAMPLES", message: "Your eyes could not be tracked reliably. Improve the lighting and recalibrate.")))
      }
      return
    }
    pairs.append(GazeCalibrationPair(raw: raw, target: shownTarget))
    targetIndex += 1
    if targetIndex < targets.count { showTarget(); return }
    guard let model = GazeAffineCalibration.fit(Array(pairs.prefix(trainingCount))),
          let error = model.validationError(Array(pairs.dropFirst(trainingCount))),
          let pose = referencePose() else {
      finish(.failure(GazeTrackingError(code: "ERR_GAZE_CALIBRATION_FIT", message: "The calibration could not distinguish the target positions. Please try again.")))
      return
    }
    finish(.success(GazeCalibrationResult(model: model, validationError: error, referencePose: pose)))
  }

  private func referencePose() -> GazeHeadPose? {
    guard !poses.isEmpty,
          let x = GazeGeometry.median(poses.map { $0.position.x }),
          let y = GazeGeometry.median(poses.map { $0.position.y }),
          let z = GazeGeometry.median(poses.map { $0.position.z }),
          let fx = GazeGeometry.median(poses.map { $0.forward.x }),
          let fy = GazeGeometry.median(poses.map { $0.forward.y }),
          let fz = GazeGeometry.median(poses.map { $0.forward.z }) else { return nil }
    let length = sqrt(fx * fx + fy * fy + fz * fz)
    guard length > 1e-6 else { return nil }
    return GazeHeadPose(position: GazeVector3(x: x, y: y, z: z), forward: GazeVector3(x: fx / length, y: fy / length, z: fz / length))
  }

  private func finish(_ result: Result<GazeCalibrationResult, GazeTrackingError>) {
    guard !finished else { return }
    finished = true
    timer?.invalidate()
    timer = nil
    let callback = onResult
    onResult = nil
    callback?(result)
  }

  deinit { timer?.invalidate() }
}
