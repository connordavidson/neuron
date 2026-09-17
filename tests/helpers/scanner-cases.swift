func check(_ value: @autoclosure () -> Bool, _ message: String) { precondition(value(), message) }
for operation in ["cancel", "cameraCancel", "failure", "success", "pageCount", "permission", "unsupported", "presentation"] {
 let promise=Promise();var finished=0
 let scanner=BookPageScanner(promise:promise) { finished += 1 }
 let presenter=UIViewController()
 AVCaptureDevice.status = operation == "permission" ? .denied : .authorized
 VNDocumentCameraViewController.isSupported = operation != "unsupported"
 scanner.start(presenter:operation == "presentation" ? nil : presenter)
 let camera=(presenter.presentedViewController as? VNDocumentCameraViewController) ?? VNDocumentCameraViewController()
 if operation == "cancel" { scanner.cancel() }
 if operation == "cameraCancel" { scanner.documentCameraViewControllerDidCancel(camera) }
 if operation == "failure" { scanner.documentCameraViewController(camera,didFailWithError:NSError(domain:"test",code:1)) }
 if operation == "success" { scanner.documentCameraViewController(camera,didFinishWith:VNDocumentCameraScan(1)) }
 if operation == "pageCount" { scanner.documentCameraViewController(camera,didFinishWith:VNDocumentCameraScan(2)) }
 scanner.cancel(); scanner.documentCameraViewControllerDidCancel(camera)
 check(finished == 1,"finish exactly once: \(operation)")
 check(promise.results.count + promise.errors.count == 1,"settle exactly once: \(operation)")
 let expected=["failure":"ERR_SCAN_CAMERA","pageCount":"ERR_SCAN_PAGE_COUNT","permission":"ERR_SCAN_PERMISSION","unsupported":"ERR_SCAN_UNSUPPORTED","presentation":"ERR_SCAN_PRESENTATION"]
 if let code=expected[operation] { check(promise.errors == [code],"error propagation: \(operation)") }
 if operation == "success" { check(promise.results.first! == "The recognized page text.","OCR text crosses bridge") }
}
AVCaptureDevice.status = .notDetermined; AVCaptureDevice.granted = false; VNDocumentCameraViewController.isSupported = true
let denied=Promise();private let scanner=BookPageScanner(promise:denied) {}
scanner.start(presenter:UIViewController());check(denied.errors == ["ERR_SCAN_PERMISSION"],"permission callback")
print("Scanner lifecycle cases passed")
