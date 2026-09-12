// Local macOS PDFKit diagnostic counterpart to the iOS extractor. Outputs are
// private test inputs, never benchmark gold or a substitute for simulator tests.
import Foundation
import PDFKit
import AppKit

guard CommandLine.arguments.count == 3 else {
  fatalError("Usage: swift tools/extract_pdfkit.swift INPUT.pdf OUTPUT.json")
}
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let document = PDFDocument(url: input) else { fatalError("Cannot open PDF") }
var pages: [String] = []
var structured: [[String: Any]] = []
var outlines: [[String: Any]] = []
func walk(_ root: PDFOutline, _ level: Int) {
  for index in 0..<root.numberOfChildren {
    guard let child = root.child(at: index) else { continue }
    let destination = child.destination ?? (child.action as? PDFActionGoTo)?.destination
    let pageIndex = destination?.page.map { document.index(for: $0) } ?? -1
    outlines.append(["title": child.label ?? "", "pageIndex": pageIndex, "level": level])
    walk(child, level + 1)
  }
}
if let root = document.outlineRoot { walk(root, 0) }
for index in 0..<document.pageCount {
  autoreleasepool {
    guard let page = document.page(at: index) else { return }
    let attributed = page.attributedString
    let text = attributed?.string ?? page.string ?? ""
    let source = text as NSString
    let bounds = page.bounds(for: .cropBox)
    var spans: [[String: Any]] = []
    var cursor = 0, lineIndex = 0
    while cursor < source.length {
      let full = source.lineRange(for: NSRange(location: cursor, length: 0))
      var length = full.length
      while length > 0 && ["\n", "\r"].contains(source.substring(with: NSRange(location: full.location + length - 1, length: 1))) { length -= 1 }
      let content = NSRange(location: full.location, length: length)
      if let attributed, length > 0, NSMaxRange(content) <= attributed.length {
        attributed.enumerateAttributes(in: content) { attributes, range, _ in
          let font = attributes[.font] as? NSFont
          let rect = page.selection(for: range)?.bounds(for: page) ?? .zero
          spans.append([
            "text": source.substring(with: range), "sourceStart": range.location,
            "sourceEnd": NSMaxRange(range), "lineIndex": lineIndex,
            "bounds": ["x": rect.minX - bounds.minX, "y": bounds.maxY - rect.maxY, "width": rect.width, "height": rect.height],
            "fontName": font?.fontName ?? "", "fontSize": font?.pointSize ?? 0,
            "bold": font?.fontDescriptor.symbolicTraits.contains(.bold) ?? false,
            "italic": font?.fontDescriptor.symbolicTraits.contains(.italic) ?? false,
          ])
        }
      }
      cursor = NSMaxRange(full)
      lineIndex += 1
    }
    pages.append(text)
    structured.append(["index": index, "label": page.label ?? "", "width": bounds.width,
      "height": bounds.height, "rotation": page.rotation, "text": text, "spans": spans, "links": []])
  }
  if (index + 1) % 100 == 0 { print("Extracted \(index + 1)/\(document.pageCount) pages") }
}
let attributes = document.documentAttributes ?? [:]
let metadata = ["title": attributes[PDFDocumentAttribute.titleAttribute] as? String ?? "",
  "author": attributes[PDFDocumentAttribute.authorAttribute] as? String ?? ""]
let result: [String: Any] = ["pages": pages, "structuredPages": structured, "outlines": outlines,
  "metadata": metadata, "title": metadata["title"] ?? "", "sourceFile": input.lastPathComponent,
  "diagnosticExtractor": "macOS PDFKit; font and geometry parity test, not iOS execution"]
try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
try JSONSerialization.data(withJSONObject: result).write(to: output, options: .atomic)
print("Wrote \(pages.count) pages and \(outlines.count) outline entries")
