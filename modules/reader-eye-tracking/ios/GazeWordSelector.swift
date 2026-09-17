import Foundation
import CoreGraphics

/// UTF-16 identity is preserved even when a passage repeats the same word.
struct GazeWordGeometry {
  let range: NSRange
  let fragments: [CGRect]
}

enum GazeWordRanges {
  static func inText(_ text: String) -> [NSRange] {
    var result: [NSRange] = []
    text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: [.byWords, .substringNotRequired]) { _, range, _, _ in
      result.append(NSRange(range, in: text))
    }
    return result
  }
}

/// Runs entirely on the native main queue. No timer advances the selection:
/// each update must originate in a fresh, usable gaze measurement.
struct GazeWordSelector {
  private(set) var selected: NSRange?
  private var smoothed: CGPoint?
  private var lastTimestamp: Double?
  private var pending: NSRange?
  private var pendingSince = 0.0

  mutating func reset() {
    selected = nil
    smoothed = nil
    lastTimestamp = nil
    pending = nil
    pendingSince = 0
  }

  mutating func update(point: CGPoint, timestamp: Double, uncertainty: CGFloat, words: [GazeWordGeometry]) -> NSRange? {
    guard point.x.isFinite, point.y.isFinite, timestamp.isFinite, !words.isEmpty else { return selected }
    if let lastTimestamp, timestamp <= lastTimestamp { return selected }

    let elapsed = lastTimestamp.map { timestamp - $0 } ?? 1
    // Reset after an interruption; otherwise low-pass only over roughly two frames.
    if let previous = smoothed, elapsed < 0.25 {
      let alpha = CGFloat(1 - exp(-elapsed / 0.025))
      smoothed = CGPoint(x: previous.x + alpha * (point.x - previous.x), y: previous.y + alpha * (point.y - previous.y))
    } else {
      smoothed = point
    }
    lastTimestamp = timestamp
    let gaze = smoothed ?? point
    let currentIndex = words.firstIndex { $0.range == selected }
    let sigma = max(8, min(60, uncertainty.isFinite ? uncertainty : 8))

    func distance(_ word: GazeWordGeometry) -> CGFloat {
      word.fragments.map { rect in
        let dx = max(rect.minX - gaze.x, 0, gaze.x - rect.maxX)
        let dy = max(rect.minY - gaze.y, 0, gaze.y - rect.maxY)
        // Text lines are close together; vertical evidence deserves more weight.
        return (dx * dx + 2.25 * dy * dy).squareRoot()
      }.min() ?? .greatestFiniteMagnitude
    }

    var bestIndex = 0
    var bestScore = CGFloat.greatestFiniteMagnitude
    for (index, word) in words.enumerated() {
      let raw = distance(word)
      var score = raw / sigma
      if let currentIndex {
        if index == currentIndex { score -= 0.10 }
        else if abs(index - currentIndex) == 1 { score -= 0.03 }
      }
      if score < bestScore { bestScore = score; bestIndex = index }
    }
    let candidate = words[bestIndex].range
    if selected == nil || currentIndex == nil {
      selected = candidate
      pending = nil
      return selected
    }
    if candidate == selected {
      pending = nil
      return selected
    }

    // A large jump wins immediately. Ambiguous neighboring boxes must win for
    // 35 ms, so noise at a boundary does not cause frame-by-frame oscillation.
    let strongEvidence = currentIndex.map { distance(words[$0]) - distance(words[bestIndex]) > max(10, sigma * 0.4) } ?? true
    if strongEvidence {
      selected = candidate
      pending = nil
    } else if pending == candidate {
      if timestamp - pendingSince >= 0.035 { selected = candidate; pending = nil }
    } else {
      pending = candidate
      pendingSince = timestamp
    }
    return selected
  }
}
