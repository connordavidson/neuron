import Foundation
// Framework doubles exercise the production scanner's lifecycle, not camera/OCR accuracy.
class Promise { var results: [String?] = []; var errors: [String] = []; func resolve(_ value: Any?) { results.append(value as? String) }; func reject(_ code: String, _ message: String) { errors.append(code) } }
struct Bundle { static let main = Bundle(); func object(forInfoDictionaryKey: String) -> Any? { "test camera permission" } }
struct DispatchQueue { static let main = DispatchQueue(); static func global(qos: QoS) -> DispatchQueue { DispatchQueue() }; enum QoS { case userInitiated }; func async(execute: () -> Void) { execute() } }
class View { var window: Int? = 1 }
class UIViewController: NSObject { var viewIfLoaded: View? = View(); var isBeingDismissed = false; var presentedViewController: UIViewController?; var title: String?; enum Presentation { case fullScreen }; var modalPresentationStyle = Presentation.fullScreen; func present(_ controller: UIViewController, animated: Bool) { presentedViewController = controller }; func dismiss(animated: Bool, completion: (() -> Void)? = nil) { completion?() } }
protocol VNDocumentCameraViewControllerDelegate: AnyObject {}
class VNDocumentCameraViewController: UIViewController { static var isSupported = true; weak var delegate: VNDocumentCameraViewControllerDelegate? }
class UIImage { enum Orientation { case up,down,left,right,upMirrored,downMirrored,leftMirrored,rightMirrored }; var imageOrientation = Orientation.up; var cgImage: Int? = 1 }
class VNDocumentCameraScan { let pageCount: Int; init(_ count: Int) { pageCount=count }; func imageOfPage(at: Int) -> UIImage { UIImage() } }
class AVCaptureDevice { enum Media { case video }; enum Status { case authorized,notDetermined,denied }; static var status = Status.authorized; static var granted = true; static func authorizationStatus(for: Media) -> Status { status }; static func requestAccess(for: Media, completionHandler: (Bool) -> Void) { completionHandler(granted) } }
enum CGImagePropertyOrientation { case up,down,left,right,upMirrored,downMirrored,leftMirrored,rightMirrored }
struct Candidate { let string: String }
struct Observation { func topCandidates(_ count: Int) -> [Candidate] { [Candidate(string:"The recognized page text.")] } }
class VNRecognizeTextRequest { enum Level { case accurate }; var recognitionLevel = Level.accurate; var usesLanguageCorrection = false; var automaticallyDetectsLanguage = false; var results: [Observation]? = [Observation()] }
struct VNImageRequestHandler { init(cgImage: Int, orientation: CGImagePropertyOrientation, options: [String:String]) {}; func perform(_ requests: [VNRecognizeTextRequest]) throws {} }
