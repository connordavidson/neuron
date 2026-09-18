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
  private let layout: GazeCalibrationLayout
  private let titleLabel = UILabel()
  private let instructionLabel = UILabel()
  private let progressLabel = UILabel()
  private let target = UIView()
  private let dot = UIView()
  private let lineGuides = (0..<5).map { _ in UIView() }
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
  private var geometry: GazeCalibrationGeometry?
  private var geometryWindowBounds: CGRect?
  private var geometryViewOrigin: CGPoint?

  init(layout: GazeCalibrationLayout) {
    self.layout = layout
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Use init(layout:)") }

  override func viewDidLoad() {
    super.viewDidLoad()
    let foreground = UIColor(calibrationHex: layout.foreground, fallback: .label)
    view.backgroundColor = UIColor(calibrationHex: layout.background, fallback: .systemBackground)
    isModalInPresentation = true
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    titleLabel.textAlignment = .center
    titleLabel.text = "Calibrate eye tracking"
    instructionLabel.font = .preferredFont(forTextStyle: .subheadline)
    instructionLabel.textAlignment = .center
    instructionLabel.numberOfLines = 3
    instructionLabel.text = "Hold your phone as you read. Follow the dot across five reading lines. About 25 seconds."
    progressLabel.font = .preferredFont(forTextStyle: .footnote)
    progressLabel.textAlignment = .center
    progressLabel.numberOfLines = 2
    let cancel = UIButton(type: .system)
    for label in [titleLabel, instructionLabel, progressLabel] { label.textColor = foreground }
    cancel.tintColor = foreground
    progress.progressTintColor = foreground
    progress.trackTintColor = foreground.withAlphaComponent(0.15)
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
      progressLabel.heightAnchor.constraint(equalToConstant: ceil(progressLabel.font.lineHeight * 2)),
      progress.bottomAnchor.constraint(equalTo: progressLabel.topAnchor, constant: -12),
      progress.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
      progress.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40)
    ])
    for line in lineGuides {
      line.backgroundColor = foreground.withAlphaComponent(0.13)
      line.isUserInteractionEnabled = false
      line.isAccessibilityElement = false
      view.addSubview(line)
    }
    target.layer.borderWidth = 1.5
    target.layer.borderColor = foreground.cgColor
    target.backgroundColor = view.backgroundColor
    target.isUserInteractionEnabled = false
    dot.backgroundColor = foreground
    target.addSubview(dot)
    view.addSubview(target)
    target.isAccessibilityElement = true
    target.accessibilityLabel = "Look at the center of this dot"
    target.isHidden = true
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    updateGeometry()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started, !finished else { return }
    view.layoutIfNeeded()
    updateGeometry()
    guard geometry != nil else { finish(.failure(layoutError)); return }
    started = true
    showTarget()
    guard !finished else { return }
    timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.tick() }
  }

  func accept(raw: GazePoint, pose: GazeHeadPose, timestamp: Double) {
    guard started, !finished, raw.isFinite, pose.position.isFinite, pose.forward.isFinite,
          timestamp.isFinite, timestamp - targetStarted >= 0.55 else { return }
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

  private var layoutError: GazeTrackingError {
    GazeTrackingError(code: "ERR_GAZE_CALIBRATION_LAYOUT", message: "The reading area changed or has too little room for calibration. Keep your phone upright and try again with a smaller text size.")
  }

  private func updateGeometry() {
    guard !finished, let window = view.window else { return }
    let viewOrigin = view.convert(CGPoint.zero, to: window)
    let minY = view.convert(CGPoint(x: 0, y: instructionLabel.frame.maxY + 16), to: window).y
    let maxY = view.convert(CGPoint(x: 0, y: progress.frame.minY - 16), to: window).y
    guard let next = layout.geometry(windowWidth: Double(window.bounds.width), windowHeight: Double(window.bounds.height), minimumY: Double(minY), maximumY: Double(maxY)) else {
      geometry = nil
      if started { finish(.failure(layoutError)) }
      return
    }
    // A rotation or viewport change must never mix observations from different
    // coordinate systems. Restart explicitly instead of silently moving targets.
    if started, next != geometry || window.bounds != geometryWindowBounds || viewOrigin != geometryViewOrigin {
      finish(.failure(layoutError))
      return
    }
    geometry = next
    geometryWindowBounds = window.bounds
    geometryViewOrigin = viewOrigin
    let diameter = CGFloat(next.targetDiameter)
    target.bounds = CGRect(x: 0, y: 0, width: diameter, height: diameter)
    target.layer.cornerRadius = diameter / 2
    let dotDiameter = min(6, diameter * 0.3)
    dot.frame = CGRect(x: (diameter - dotDiameter) / 2, y: (diameter - dotDiameter) / 2, width: dotDiameter, height: dotDiameter)
    dot.layer.cornerRadius = dotDiameter / 2
    for (index, line) in lineGuides.enumerated() {
      let start = view.convert(CGPoint(x: next.textX, y: next.rowCenters[index]), from: window)
      line.frame = CGRect(x: start.x, y: start.y - 0.5, width: next.textWidth, height: 1)
    }
  }

  private func showTarget() {
    guard let geometry, targetIndex < geometry.targets.count, let window = view.window else {
      finish(.failure(GazeTrackingError(code: "ERR_GAZE_WINDOW", message: "Open the reader again to calibrate eye tracking.")))
      return
    }
    let desired = geometry.targets[targetIndex]
    // Each jump settles before samples are accepted. Fit against the ACTUAL
    // rendered center converted into normalized window coordinates.
    target.center = view.convert(CGPoint(x: desired.x, y: desired.y), from: window)
    target.isHidden = false
    let windowPoint = view.convert(target.center, to: window)
    shownTarget = GazePoint(x: Double(windowPoint.x / window.bounds.width), y: Double(windowPoint.y / window.bounds.height))
    rawSamples.removeAll(keepingCapacity: true)
    targetStarted = CACurrentMediaTime()
    titleLabel.text = targetIndex < geometry.training.count ? "Calibrate eye tracking" : "Check eye tracking"
    progressLabel.text = "Dot \(targetIndex + 1) of \(geometry.targets.count)"
    progress.setProgress(Float(targetIndex) / Float(geometry.targets.count), animated: true)
  }

  private func tick() {
    guard !finished, let geometry else { return }
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
    if targetIndex < geometry.targets.count { showTarget(); return }
    guard let model = GazeAffineCalibration.fit(Array(pairs.prefix(geometry.training.count))),
          let error = model.validationError(Array(pairs.dropFirst(geometry.training.count))),
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

private extension UIColor {
  convenience init(calibrationHex: String, fallback: UIColor) {
    let hex = calibrationHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    guard hex.count == 6 || hex.count == 8, let value = UInt64(hex, radix: 16) else {
      self.init(cgColor: fallback.cgColor)
      return
    }
    let rgba = hex.count == 6 ? (value << 8) | 0xFF : value
    self.init(red: CGFloat((rgba >> 24) & 0xFF) / 255, green: CGFloat((rgba >> 16) & 0xFF) / 255, blue: CGFloat((rgba >> 8) & 0xFF) / 255, alpha: CGFloat(rgba & 0xFF) / 255)
  }
}
