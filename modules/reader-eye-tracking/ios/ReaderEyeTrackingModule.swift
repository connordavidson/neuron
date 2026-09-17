import ExpoModulesCore

public final class ReaderEyeTrackingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReaderEyeTracking")
    Events("onStatus")

    OnCreate {
      DispatchQueue.main.async {
        GazeTracker.shared.onStatus = { [weak self] status in self?.sendEvent("onStatus", status) }
      }
    }
    OnDestroy { DispatchQueue.main.async { GazeTracker.shared.shutdown() } }

    Function("getCapabilities") { GazeTracker.capabilities() }

    AsyncFunction("start") { (sessionId: String, promise: Promise) in
      GazeTracker.shared.start(sessionId) { result in self.resolve(promise, result) }
    }.runOnQueue(.main)
    AsyncFunction("pause") { (sessionId: String, promise: Promise) in
      GazeTracker.shared.pause(sessionId) { result in self.resolve(promise, result) }
    }.runOnQueue(.main)
    AsyncFunction("stop") { (sessionId: String, promise: Promise) in
      GazeTracker.shared.stop(sessionId) { result in self.resolve(promise, result) }
    }.runOnQueue(.main)
    AsyncFunction("calibrate") { (sessionId: String, promise: Promise) in
      GazeTracker.shared.calibrate(sessionId, presenter: self.appContext?.utilities?.currentViewController()) { result in self.resolve(promise, result) }
    }.runOnQueue(.main)

    View(ReaderGazeView.self) {
      Events("onTextLayout", "onWordChange", "onPress")
      Prop("text") { (view: ReaderGazeView, value: String) in view.text = value }
      Prop("fontSize") { (view: ReaderGazeView, value: Double) in view.fontSize = value }
      Prop("fontScale") { (view: ReaderGazeView, value: Double) in view.fontScale = value }
      Prop("textColor") { (view: ReaderGazeView, value: String) in view.textColor = value }
      Prop("sessionId") { (view: ReaderGazeView, value: String) in view.sessionId = value }
      Prop("passageId") { (view: ReaderGazeView, value: String) in view.passageId = value }
      Prop("layoutRevision") { (view: ReaderGazeView, value: String) in view.layoutRevision = value }
      Prop("trackingActive") { (view: ReaderGazeView, value: Bool) in view.trackingActive = value }
      Prop("pageIndex") { (view: ReaderGazeView, value: Int) in view.pageIndex = value }
      Prop("pageHeight") { (view: ReaderGazeView, value: Double) in view.pageHeight = value }
    }
  }

  private func resolve(_ promise: Promise, _ result: Result<Void, GazeTrackingError>) {
    switch result {
    case .success: promise.resolve(nil)
    case .failure(let error): promise.reject(error.code, error.message)
    }
  }
}
