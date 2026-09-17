import ExpoModulesCore
import UIKit

private final class GazeDisplayLinkTarget: NSObject {
  weak var view: ReaderGazeView?
  @objc func tick(_ link: CADisplayLink) { view?.displayFrame(link.timestamp) }
}

/// TextKit 1 owns both drawing and geometry. There is no hidden measurement
/// copy of the text whose wrapping could diverge from the visible passage.
final class ReaderGazeView: ExpoView, UITextViewDelegate, UIGestureRecognizerDelegate {
  let onTextLayout = EventDispatcher()
  let onWordChange = EventDispatcher()
  let onPress = EventDispatcher()

  var text = "" { didSet { if text != oldValue { invalidateText() } } }
  var fontSize = 24.0 { didSet { if fontSize != oldValue { invalidateText() } } }
  var fontScale = 1.0 { didSet { if fontScale != oldValue { invalidateText() } } }
  var textColor = "#000000" { didSet { if textColor != oldValue { invalidateText() } } }
  var sessionId = "" { didSet { if sessionId != oldValue { resetTarget() } } }
  var passageId = "" { didSet { if passageId != oldValue { resetTarget() } } }
  var pageIndex = -1 { didSet { if pageIndex != oldValue { resetTarget() } } }
  var pageHeight = 0.0 { didSet { if pageHeight != oldValue { resetTarget() } } }
  var layoutRevision = "" { didSet { if layoutRevision != oldValue { invalidateText() } } }
  var trackingActive = false {
    didSet {
      if trackingActive != oldValue { resetTarget(); updateSubscription() }
    }
  }

  private let storage = NSTextStorage()
  private let manager = NSLayoutManager()
  private let container = NSTextContainer(size: .zero)
  private var textView: UITextView!
  private let outline = CAShapeLayer()
  private let observerId = UUID()
  private let linkTarget = GazeDisplayLinkTarget()
  private var displayLink: CADisplayLink?
  private var observing = false
  private var textDirty = true
  private var geometryDirty = true
  private var wordRanges: [NSRange] = []
  private var words: [GazeWordGeometry] = []
  private var visibleWords: [GazeWordGeometry] = []
  private var visibleWordsRect: CGRect?
  private var selector = GazeWordSelector()
  private var lastWindowRect: CGRect?
  private var lastVisibleRect: CGRect?
  private var stableFrames = 0
  private var lastUsableAt: Double?
  private var lastSampleAt = -Double.greatestFiniteMagnitude
  private var acceptSamplesAfter = 0.0
  private var lastEmittedWord: NSRange?
  private var lastEmittedQuality: String?
  private var selectedQuality = "tracking"
  private var previousHeight: CGFloat = -1
  private var previousRevision = ""
  private var suppressed = true

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    manager.usesFontLeading = false
    storage.addLayoutManager(manager)
    manager.addTextContainer(container)
    container.lineFragmentPadding = 0
    container.maximumNumberOfLines = 0
    container.lineBreakMode = .byWordWrapping
    container.widthTracksTextView = false
    container.heightTracksTextView = false
    textView = UITextView(frame: .zero, textContainer: container)
    textView.isEditable = false
    textView.isSelectable = true
    textView.isScrollEnabled = false
    textView.textContainerInset = .zero
    textView.contentInset = .zero
    textView.contentInsetAdjustmentBehavior = .never
    textView.backgroundColor = .clear
    textView.dataDetectorTypes = []
    textView.delegate = self
    textView.accessibilityHint = "Swipe up or down for another reading page. Tap to hide or show controls."
    // UITextView alone supplies the text's accessible representation and copy menu.
    isAccessibilityElement = false
    addSubview(textView)

    outline.fillColor = UIColor.clear.cgColor
    outline.lineWidth = 1.25
    outline.isHidden = true
    layer.addSublayer(outline)

    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    tap.cancelsTouchesInView = false
    tap.delegate = self
    textView.addGestureRecognizer(tap)
    linkTarget.view = self
  }

  deinit {
    displayLink?.invalidate()
    GazeTracker.shared.removeObserver(id: observerId)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    resetTarget()
    updateSubscription()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = max(0, bounds.width)
    if container.size.width != width { geometryDirty = true; resetTarget() }
    textView.frame = bounds
    container.size = CGSize(width: width, height: .greatestFiniteMagnitude)
    if textDirty { updateText() }
    guard width > 0 else { return }
    manager.ensureLayout(for: container)
    if geometryDirty { rebuildGeometry() }
    let height = ceil(manager.usedRect(for: container).height * (window?.screen.scale ?? 2)) / (window?.screen.scale ?? 2)
    if height != previousHeight || layoutRevision != previousRevision {
      previousHeight = height
      previousRevision = layoutRevision
      onTextLayout(["height": height, "layoutRevision": layoutRevision])
    }
  }

  private func updateText() {
    textDirty = false
    let scale = CGFloat(fontScale.isFinite ? max(0.5, min(fontScale, 5)) : 1)
    let baseSize = CGFloat(fontSize.isFinite ? max(1, min(fontSize, 200)) : 24)
    let font = UIFont(name: "Georgia", size: baseSize * scale) ?? UIFont.systemFont(ofSize: baseSize * scale)
    let paragraph = NSMutableParagraphStyle()
    let lineHeight = (baseSize * 1.52).rounded() * scale
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
    paragraph.lineBreakMode = .byWordWrapping
    let color = UIColor(gazeHex: textColor)
    // These match React Native's fixed line-height baseline and letter spacing.
    storage.setAttributedString(NSAttributedString(string: text, attributes: [
      .font: font, .foregroundColor: color, .paragraphStyle: paragraph,
      .kern: 0.1, .baselineOffset: max(0, (lineHeight - font.lineHeight) / 2),
    ]))
    textView.selectedRange = NSRange(location: 0, length: 0)
    outline.strokeColor = color.cgColor
    wordRanges = GazeWordRanges.inText(text)
    geometryDirty = true
  }

  private func rebuildGeometry() {
    geometryDirty = false
    visibleWordsRect = nil
    words = wordRanges.compactMap { range in
      let glyphs = manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
      var fragments: [CGRect] = []
      manager.enumerateLineFragments(forGlyphRange: glyphs) { [self] _, _, _, lineGlyphs, _ in
        let part = NSIntersectionRange(glyphs, lineGlyphs)
        if part.length > 0 {
          let rect = manager.boundingRect(forGlyphRange: part, in: container)
          if !rect.isEmpty && !rect.isNull { fragments.append(rect) }
        }
      }
      return fragments.isEmpty ? nil : GazeWordGeometry(range: range, fragments: fragments)
    }
  }

  private func invalidateText() {
    textDirty = true
    geometryDirty = true
    resetTarget()
    setNeedsLayout()
  }

  private func resetTarget() {
    selector.reset()
    lastUsableAt = nil
    lastSampleAt = -Double.greatestFiniteMagnitude
    acceptSamplesAfter = CACurrentMediaTime()
    lastEmittedWord = nil
    lastEmittedQuality = nil
    stableFrames = 0
    lastWindowRect = nil
    lastVisibleRect = nil
    suppressed = true
    outline.path = nil
    outline.isHidden = true
  }

  private func updateSubscription() {
    let eligible = trackingActive && window != nil
    if eligible && !observing {
      observing = true
      GazeTracker.shared.addObserver(id: observerId) { [weak self] sample in self?.receive(sample) }
      let link = CADisplayLink(target: linkTarget, selector: #selector(GazeDisplayLinkTarget.tick(_:)))
      link.add(to: .main, forMode: .common)
      displayLink = link
    } else if !eligible {
      GazeTracker.shared.removeObserver(id: observerId)
      observing = false
      displayLink?.invalidate()
      displayLink = nil
      outline.isHidden = true
    }
  }

  /// This also checks parent scrolling: nested overflow and page swipes both
  /// move native geometry before React is necessarily told that movement began.
  private func visibleGeometry() -> (window: UIWindow, windowRect: CGRect, visible: CGRect)? {
    guard let window, trackingActive, UIApplication.shared.applicationState == .active,
          !sessionId.isEmpty, !passageId.isEmpty,
          textView.selectedRange.length == 0, !textDirty, !geometryDirty,
          bounds.width > 0, bounds.height > 0 else { return nil }
    var visible = convert(window.bounds, from: window).intersection(bounds)
    var current: UIView? = self
    var outermostScroll: UIScrollView?
    while let view = current {
      if view.isHidden || view.alpha < 0.01 { return nil }
      if let scroll = view as? UIScrollView {
        if scroll.isTracking || scroll.isDragging || scroll.isDecelerating { return nil }
        outermostScroll = scroll
      }
      if view.clipsToBounds { visible = visible.intersection(convert(view.bounds, from: view)) }
      current = view.superview
    }
    // JS settlement can precede a programmatic native scroll. Independently
    // verify the expected page against the outer FlatList's real offset.
    guard pageIndex >= 0, pageHeight.isFinite, pageHeight > 0, let pagingScroll = outermostScroll,
          abs(pagingScroll.bounds.height - CGFloat(pageHeight)) <= 1,
          abs(pagingScroll.contentOffset.y + pagingScroll.adjustedContentInset.top - CGFloat(pageIndex) * CGFloat(pageHeight)) <= 1 else { return nil }
    guard !visible.isEmpty, !visible.isNull else { return nil }
    return (window, convert(bounds, to: window), visible)
  }

  fileprivate func displayFrame(_ timestamp: Double) {
    guard let geometry = visibleGeometry() else { suppressForMovement(); return }
    let same = lastWindowRect.map { $0.approximatelyEquals(geometry.windowRect) } == true
      && lastVisibleRect.map { $0.approximatelyEquals(geometry.visible) } == true
    lastWindowRect = geometry.windowRect
    lastVisibleRect = geometry.visible
    stableFrames = same ? stableFrames + 1 : 0
    if !same { suppressForMovement(resetStability: false) }
    guard stableFrames >= 2 else { return }
    // Resumption always requires a new usable gaze frame. Display ticks only
    // dim the last estimate, and never choose another word.
    if !suppressed, let lastUsableAt, timestamp - lastUsableAt >= 0.5 { drawSelected(quality: "unavailable", visible: geometry.visible) }
  }

  private func suppressForMovement(resetStability: Bool = true) {
    if resetStability { stableFrames = 0; lastWindowRect = nil; lastVisibleRect = nil }
    if !suppressed { selector.reset(); lastUsableAt = nil; acceptSamplesAfter = CACurrentMediaTime() }
    suppressed = true
    outline.isHidden = true
  }

  private func receive(_ sample: GazeSample) {
    guard sample.sessionId == sessionId, sample.timestamp.isFinite, sample.timestamp >= acceptSamplesAfter, sample.timestamp > lastSampleAt,
          trackingActive else { return }
    lastSampleAt = sample.timestamp
    guard let x = sample.x, let y = sample.y, x.isFinite, y.isFinite else {
      if ["paused", "calibrating", "stopped", "interrupted", "unavailable", "error"].contains(sample.quality) {
        suppressForMovement()
      }
      return
    }
    guard let geometry = visibleGeometry() else { suppressForMovement(); return }
    guard stableFrames >= 2 else { return }
    guard
          lastWindowRect?.approximatelyEquals(geometry.windowRect) == true,
          lastVisibleRect?.approximatelyEquals(geometry.visible) == true else { suppressForMovement(); return }
    let point = convert(CGPoint(x: geometry.window.bounds.minX + CGFloat(x) * geometry.window.bounds.width,
                               y: geometry.window.bounds.minY + CGFloat(y) * geometry.window.bounds.height), from: geometry.window)
    // Looking at controls or away from the display is not evidence for the
    // nearest edge word. Hold the last estimate and let its 500 ms timeout dim it.
    guard (0...1).contains(x), (0...1).contains(y), geometry.visible.contains(point) else { return }
    if visibleWordsRect != geometry.visible {
      visibleWordsRect = geometry.visible
      visibleWords = words.compactMap { word -> GazeWordGeometry? in
        let fragments = word.fragments.map { $0.intersection(geometry.visible) }.filter { !$0.isNull && !$0.isEmpty }
        return fragments.isEmpty ? nil : GazeWordGeometry(range: word.range, fragments: fragments)
      }
    }
    let uncertainty = CGFloat(sample.validationError) * min(geometry.window.bounds.width, geometry.window.bounds.height)
    _ = selector.update(point: point, timestamp: sample.timestamp, uncertainty: uncertainty, words: visibleWords)
    lastUsableAt = sample.timestamp
    selectedQuality = sample.quality
    suppressed = false
    drawSelected(quality: selectedQuality, visible: geometry.visible)
  }

  private func drawSelected(quality: String, visible: CGRect) {
    guard let selected = selector.selected, let word = words.first(where: { $0.range == selected }) else { outline.isHidden = true; return }
    let path = UIBezierPath()
    for rect in word.fragments {
      let clipped = rect.insetBy(dx: -2, dy: -1).intersection(visible)
      if !clipped.isNull && !clipped.isEmpty { path.append(UIBezierPath(roundedRect: clipped, cornerRadius: 3)) }
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    outline.path = path.cgPath
    outline.opacity = quality == "unavailable" ? 0.30 : 0.85
    outline.isHidden = path.isEmpty
    CATransaction.commit()
    if selected != lastEmittedWord || quality != lastEmittedQuality {
      lastEmittedWord = selected
      lastEmittedQuality = quality
      onWordChange(["sessionId": sessionId, "passageId": passageId, "layoutRevision": layoutRevision,
                    "start": selected.location, "end": NSMaxRange(selected), "quality": quality])
    }
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    if textView.selectedRange.length > 0 { suppressForMovement() }
  }

  @objc private func tapped(_ gesture: UITapGestureRecognizer) {
    guard gesture.state == .ended, textView.selectedRange.length == 0 else { return }
    onPress([:])
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
}

private extension CGRect {
  func approximatelyEquals(_ other: CGRect) -> Bool {
    abs(minX - other.minX) < 0.25 && abs(minY - other.minY) < 0.25
      && abs(width - other.width) < 0.25 && abs(height - other.height) < 0.25
  }
}

private extension UIColor {
  convenience init(gazeHex: String) {
    let hex = gazeHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    guard hex.count == 6 || hex.count == 8, let value = UInt64(hex, radix: 16) else { self.init(white: 0, alpha: 1); return }
    let rgba = hex.count == 6 ? (value << 8) | 0xFF : value
    self.init(red: CGFloat((rgba >> 24) & 0xFF) / 255, green: CGFloat((rgba >> 16) & 0xFF) / 255,
              blue: CGFloat((rgba >> 8) & 0xFF) / 255, alpha: CGFloat(rgba & 0xFF) / 255)
  }
}
