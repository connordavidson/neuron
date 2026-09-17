func check(_ value: @autoclosure () -> Bool, _ message: String) { precondition(value(), message) }

let passage = "read read, café 😀 don't 東京."
let ranges = GazeWordRanges.inText(passage)
let tokens = ranges.map { (passage as NSString).substring(with: $0) }
check(tokens.prefix(3).elementsEqual(["read", "read", "café"]), "Repeated words and punctuation preserve independent ranges")
check(ranges[0] != ranges[1], "Repeated words have distinct identities")
check(tokens.contains("don't"), "Apostrophes stay within a word")
check(tokens.contains("東京"), "CJK is tokenized")
check(ranges.allSatisfy { Range($0, in: passage) != nil }, "Every UTF-16 range respects Unicode boundaries")
check(ranges.last!.location > passage.distance(from: passage.startIndex, to: passage.range(of: "東京")!.lowerBound), "Ranges use UTF-16 rather than grapheme offsets")
check(GazeWordRanges.inText("  \n... ").isEmpty, "Blank or punctuation-only passages have no word targets")

let words = (0..<9).map { index in
  GazeWordGeometry(range: NSRange(location: index * 5, length: 4),
                   fragments: [CGRect(x: (index % 3) * 60, y: (index / 3) * 44, width: 40, height: 24)])
}
var selector = GazeWordSelector()
func update(_ x: Double, _ y: Double, _ time: Double, uncertainty: CGFloat = 16) -> NSRange? {
  selector.update(point: CGPoint(x: x, y: y), timestamp: time, uncertainty: uncertainty, words: words)
}
check(update(20, 12, 1) == words[0].range, "First usable gaze picks a word immediately")
check(update(140, 100, 1.1) == words[8].range, "Strong gaze can skip arbitrarily far ahead")
check(update(20, 12, 1.2) == words[0].range, "Regressions are allowed")
check(update(140, 12, 1.3) == words[2].range, "Line end can be selected")
check(update(20, 56, 1.4) == words[3].range, "Line returns do not require stepping through intervening words")
let current = selector.selected
check(update(140, 100, 1.3) == current, "Out-of-order frames cannot rewind the filter")
check(update(Double.nan, 12, 1.5) == current, "Invalid measurements hold the last word")
check(update(140, 100, .infinity) == current, "Invalid timestamps do not poison filtering")
selector.reset()
check(selector.selected == nil, "New passage or layout cannot retain the old word")

// At a word boundary, the selected word should survive tiny eye jitter.
check(update(20, 12, 2) == words[0].range, "Reset accepts a fresh sequence")
for index in 1...8 {
  let x = index.isMultiple(of: 2) ? 49.0 : 50.0
  check(update(x, 12, 2 + Double(index) / 60) == words[0].range, "Boundary noise keeps a stable estimate")
}
check(update(80, 12, 2.3) == words[1].range, "Stable gaze in a neighboring word eventually wins")
check(update(-500, -500, 2.4, uncertainty: 1_000) != nil, "Low confidence still supplies the best visible estimate")

let wrapped = [GazeWordGeometry(range: NSRange(location: 0, length: 20), fragments: [
  CGRect(x: 100, y: 0, width: 40, height: 24), CGRect(x: 0, y: 44, width: 40, height: 24),
]), GazeWordGeometry(range: NSRange(location: 21, length: 4), fragments: [CGRect(x: 60, y: 44, width: 40, height: 24)])]
selector.reset()
check(selector.update(point: CGPoint(x: 20, y: 56), timestamp: 3, uncertainty: 16, words: wrapped) == wrapped[0].range,
      "A wrapped word can be selected through either visual fragment")
let held = selector.selected
check(selector.update(point: CGPoint(x: 80, y: 56), timestamp: 3.1, uncertainty: 16, words: []) == held,
      "No visible words do not invent a new target")
print("Gaze word selection cases passed")
