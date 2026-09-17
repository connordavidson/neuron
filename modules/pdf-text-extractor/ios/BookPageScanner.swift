import ExpoModulesCore
import UIKit
import Vision
import VisionKit
import AVFoundation

// Retained by the module because VisionKit holds its delegate weakly. Images
// stay in memory; only recognized text crosses the bridge to the reader.
final class BookPageScanner: NSObject, VNDocumentCameraViewControllerDelegate {
  private let promise: Promise
  private let onFinish: () -> Void
  private var finished = false
  private weak var camera: VNDocumentCameraViewController?

  init(promise: Promise, onFinish: @escaping () -> Void) {
    self.promise = promise
    self.onFinish = onFinish
  }

  func start(presenter: UIViewController?) {
    guard VNDocumentCameraViewController.isSupported else {
      finish(error: "ERR_SCAN_UNSUPPORTED", message: "Page scanning requires a supported physical iPhone or iPad.")
      return
    }
    guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil else {
      finish(error: "ERR_SCAN_REBUILD", message: "Rebuild the iOS app to enable page scanning.")
      return
    }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      present(from: presenter)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          if granted { self.present(from: presenter) }
          else { self.permissionDenied() }
        }
      }
    default:
      permissionDenied()
    }
  }

  private func permissionDenied() {
    finish(error: "ERR_SCAN_PERMISSION", message: "Allow camera access in Settings to scan a book page.")
  }

  private func present(from presenter: UIViewController?) {
    guard !finished else { return }
    guard let presenter, presenter.viewIfLoaded?.window != nil,
          !presenter.isBeingDismissed, presenter.presentedViewController == nil else {
      finish(error: "ERR_SCAN_PRESENTATION", message: "Open your ebook and try scanning again.")
      return
    }
    let controller = VNDocumentCameraViewController()
    // VisionKit owns the rest of this interface, but it honors the controller
    // title on current iOS releases instead of presenting its generic document
    // label.
    controller.title = "Scan page"
    camera = controller
    controller.delegate = self
    controller.modalPresentationStyle = .fullScreen
    presenter.present(controller, animated: true)
  }

  func cancel() {
    camera?.delegate = nil
    camera?.dismiss(animated: false)
    finish()
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true) { self.finish() }
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    controller.dismiss(animated: true) {
      self.finish(error: "ERR_SCAN_CAMERA", message: "The camera could not scan this page. Please try again.")
    }
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    guard scan.pageCount == 1 else {
      controller.dismiss(animated: true) {
        self.finish(error: "ERR_SCAN_PAGE_COUNT", message: "Scan just one book page, then tap Save.")
      }
      return
    }
    let image = scan.imageOfPage(at: 0)
    controller.dismiss(animated: true) {
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let request = VNRecognizeTextRequest()
          request.recognitionLevel = .accurate
          request.usesLanguageCorrection = true
          request.automaticallyDetectsLanguage = true
          guard let cgImage = image.cgImage else {
            DispatchQueue.main.async {
              self.finish(error: "ERR_SCAN_IMAGE", message: "This scan could not be read. Please try again.")
            }
            return
          }
          let orientation: CGImagePropertyOrientation
          switch image.imageOrientation {
          case .up: orientation = .up
          case .down: orientation = .down
          case .left: orientation = .left
          case .right: orientation = .right
          case .upMirrored: orientation = .upMirrored
          case .downMirrored: orientation = .downMirrored
          case .leftMirrored: orientation = .leftMirrored
          case .rightMirrored: orientation = .rightMirrored
          @unknown default: orientation = .up
          }
          try VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:]).perform([request])
          let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
          DispatchQueue.main.async { self.finish(text: text) }
        } catch {
          DispatchQueue.main.async {
            self.finish(error: "ERR_SCAN_OCR", message: "The text could not be read. Try a sharper scan in good light.")
          }
        }
      }
    }
  }

  private func finish(text: String? = nil, error: String? = nil, message: String = "") {
    guard !finished else { return }
    finished = true
    onFinish()
    if let error { promise.reject(error, message) }
    else { promise.resolve(text as Any?) }
  }
}
