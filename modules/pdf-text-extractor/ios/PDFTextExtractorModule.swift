import ExpoModulesCore
import PDFKit
import UIKit

struct PDFExtractionResult: Record {
  @Field var title: String = ""
  @Field var pages: [String] = []
  @Field var outlines: [PDFOutlineItem] = []
  @Field var pageLineFonts: [[Double]] = []
}

struct PDFOutlineItem: Record {
  @Field var title: String = ""
  @Field var pageIndex: Int = -1
  @Field var level: Int = 0
}

public class PDFTextExtractorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PDFTextExtractor")

    AsyncFunction("extract") { (uri: String) throws -> PDFExtractionResult in
      guard let url = URL(string: uri), url.isFileURL else {
        throw Exception(
          name: "InvalidPDFLocation",
          description: "FlowReader could not access the selected file.",
          code: "ERR_INVALID_PDF_LOCATION"
        )
      }

      guard let document = PDFDocument(url: url) else {
        throw Exception(
          name: "InvalidPDF",
          description: "The selected file could not be opened as a PDF.",
          code: "ERR_INVALID_PDF"
        )
      }

      var pages: [String] = []
      var pageLineFonts: [[Double]] = []
      pages.reserveCapacity(document.pageCount)

      for index in 0..<document.pageCount {
        let page = document.page(at: index)
        let attributed = page?.attributedString
        let text = attributed?.string ?? page?.string ?? ""
        pages.append(text)
        pageLineFonts.append(self.leadingLineFonts(attributed, text: text))
      }

      guard !pages.isEmpty else {
        throw Exception(
          name: "PDFHasNoText",
          description: "This PDF has no selectable text. Try running OCR on it first.",
          code: "ERR_PDF_HAS_NO_TEXT"
        )
      }

      let rawTitle = document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String
      let title = rawTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      return PDFExtractionResult(
        title: title,
        pages: pages,
        outlines: extractOutlines(from: document),
        pageLineFonts: pageLineFonts
      )
    }
  }

  private func leadingLineFonts(_ attributed: NSAttributedString?, text: String) -> [Double] {
    guard let attributed = attributed else { return [] }
    var location = 0
    return text.components(separatedBy: "\n").prefix(20).map { line in
      let length = (line as NSString).length
      var size = 0.0
      if length > 0 && location + length <= attributed.length {
        attributed.enumerateAttribute(.font, in: NSRange(location: location, length: length)) { value, _, _ in
          if let font = value as? UIFont { size = max(size, Double(font.pointSize)) }
        }
      }
      location += length + 1
      return size
    }
  }

  private func extractOutlines(from document: PDFDocument) -> [PDFOutlineItem] {
    guard let root = document.outlineRoot else { return [] }

    var result: [PDFOutlineItem] = []
    walkOutline(root, document: document, level: 0, into: &result)
    return result
  }

  private func walkOutline(
    _ outline: PDFOutline,
    document: PDFDocument,
    level: Int,
    into result: inout [PDFOutlineItem]
  ) {
    for index in 0..<outline.numberOfChildren {
      guard let child = outline.child(at: index) else { continue }

      let title = child.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let destination = child.destination ?? (child.action as? PDFActionGoTo)?.destination
      let pageIndex = destination.flatMap { destination in
        destination.page.map { document.index(for: $0) }
      } ?? -1

      if !title.isEmpty {
        result.append(PDFOutlineItem(title: title, pageIndex: pageIndex, level: level))
      }
      walkOutline(child, document: document, level: level + 1, into: &result)
    }
  }
}
