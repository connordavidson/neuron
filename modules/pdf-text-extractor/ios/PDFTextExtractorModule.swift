import ExpoModulesCore
import PDFKit
import UIKit
import NaturalLanguage

struct PDFExtractionResult: Record {
  @Field var title: String = ""
  @Field var pages: [String] = []
  @Field var outlines: [PDFOutlineItem] = []
  @Field var pageLineFonts: [[Double]] = []
  @Field var structuredPages: [PDFPageExtraction] = []
  @Field var metadata: PDFDocumentMetadata = PDFDocumentMetadata()
}

struct PDFOutlineItem: Record {
  @Field var title: String = ""
  @Field var pageIndex: Int = -1
  @Field var level: Int = 0
  @Field var x: Double = 0
  @Field var y: Double = 0
}

struct PDFRectRecord: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0
}

struct PDFTextSpanRecord: Record {
  @Field var text: String = ""
  @Field var sourceStart: Int = 0
  @Field var sourceEnd: Int = 0
  @Field var lineIndex: Int = 0
  @Field var bounds: PDFRectRecord = PDFRectRecord()
  @Field var fontName: String = ""
  @Field var fontSize: Double = 0
  @Field var bold: Bool = false
  @Field var italic: Bool = false
  @Field var color: String = ""
}

struct PDFLinkRecord: Record {
  @Field var bounds: PDFRectRecord = PDFRectRecord()
  @Field var url: String = ""
  @Field var destinationPageIndex: Int = -1
}

struct PDFPageExtraction: Record {
  @Field var index: Int = 0
  @Field var label: String = ""
  @Field var width: Double = 0
  @Field var height: Double = 0
  @Field var rotation: Int = 0
  @Field var text: String = ""
  @Field var spans: [PDFTextSpanRecord] = []
  @Field var links: [PDFLinkRecord] = []
}

struct PDFDocumentMetadata: Record {
  @Field var title: String = ""
  @Field var author: String = ""
  @Field var subject: String = ""
  @Field var creator: String = ""
  @Field var producer: String = ""
  @Field var keywords: [String] = []
  @Field var creationDate: String = ""
  @Field var modificationDate: String = ""
}

public class PDFTextExtractorModule: Module {
  private var pageScanner: BookPageScanner?

  public func definition() -> ModuleDefinition {
    Name("PDFTextExtractor")

    OnDestroy {
      DispatchQueue.main.async { self.pageScanner?.cancel() }
    }

    AsyncFunction("scanBookPage") { (promise: Promise) in
      guard self.pageScanner == nil else {
        promise.reject("ERR_SCAN_BUSY", "A page scan is already in progress.")
        return
      }
      let scanner = BookPageScanner(promise: promise) { [weak self] in
        self?.pageScanner = nil
      }
      self.pageScanner = scanner
      scanner.start(presenter: self.appContext?.utilities?.currentViewController())
    }.runOnQueue(.main)

    AsyncFunction("sentenceBoundaries") { (texts: [String]) -> [[Int]] in
      texts.map { text in
        // A new tokenizer per passage keeps all access on this invocation's queue.
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text
        return tokenizer.tokens(for: text.startIndex..<text.endIndex).map { range in
          NSMaxRange(NSRange(range, in: text))
        }
      }
    }

    AsyncFunction("extract") { (uri: String) throws -> PDFExtractionResult in
      guard let url = URL(string: uri), url.isFileURL else {
        throw Exception(
          name: "InvalidPDFLocation",
          description: "Neuron could not access the selected file.",
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
      var structuredPages: [PDFPageExtraction] = []
      pages.reserveCapacity(document.pageCount)
      structuredPages.reserveCapacity(document.pageCount)

      for index in 0..<document.pageCount {
        let page = document.page(at: index)
        let attributed = page?.attributedString
        let text = attributed?.string ?? page?.string ?? ""
        pages.append(text)
        pageLineFonts.append(self.leadingLineFonts(attributed, text: text))
        if let page {
          structuredPages.append(self.extractPage(page, index: index, document: document, attributed: attributed, text: text))
        } else {
          structuredPages.append(PDFPageExtraction(index: index, text: text))
        }
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
        pageLineFonts: pageLineFonts,
        structuredPages: structuredPages,
        metadata: extractMetadata(from: document)
      )
    }
  }

  private func extractPage(
    _ page: PDFPage,
    index: Int,
    document: PDFDocument,
    attributed: NSAttributedString?,
    text: String
  ) -> PDFPageExtraction {
    let pageBounds = page.bounds(for: .cropBox)
    var spans: [PDFTextSpanRecord] = []
    if let attributed, attributed.length > 0 {
      let source = text as NSString
      var cursor = 0
      var lineIndex = 0
      while cursor < source.length {
        let fullLineRange = source.lineRange(for: NSRange(location: cursor, length: 0))
        var contentLength = fullLineRange.length
        while contentLength > 0 {
          let scalar = source.substring(with: NSRange(location: fullLineRange.location + contentLength - 1, length: 1))
          if scalar == "\n" || scalar == "\r" { contentLength -= 1 } else { break }
        }
        let contentRange = NSRange(location: fullLineRange.location, length: contentLength)
        if contentRange.length > 0 && NSMaxRange(contentRange) <= attributed.length {
          attributed.enumerateAttributes(in: contentRange) { attributes, range, _ in
            let value = source.substring(with: range)
            guard !value.isEmpty else { return }
            let font = attributes[.font] as? UIFont
            let traits = font?.fontDescriptor.symbolicTraits ?? []
            let selectionBounds = page.selection(for: range)?.bounds(for: page) ?? .zero
            spans.append(PDFTextSpanRecord(
              text: value,
              sourceStart: range.location,
              sourceEnd: NSMaxRange(range),
              lineIndex: lineIndex,
              bounds: self.rectRecord(selectionBounds, pageBounds: pageBounds),
              fontName: font?.fontName ?? "",
              fontSize: Double(font?.pointSize ?? 0),
              bold: traits.contains(.traitBold),
              italic: traits.contains(.traitItalic),
              color: self.colorHex(attributes[.foregroundColor] as? UIColor)
            ))
          }
        }
        cursor = NSMaxRange(fullLineRange)
        lineIndex += 1
      }
    }

    let links = page.annotations.compactMap { annotation -> PDFLinkRecord? in
      guard annotation.action is PDFActionURL || annotation.action is PDFActionGoTo || annotation.destination != nil else { return nil }
      let destination = (annotation.action as? PDFActionGoTo)?.destination ?? annotation.destination
      let destinationPage = destination.flatMap { $0.page }.map { document.index(for: $0) } ?? -1
      let url = (annotation.action as? PDFActionURL)?.url?.absoluteString ?? ""
      return PDFLinkRecord(
        bounds: self.rectRecord(annotation.bounds, pageBounds: pageBounds),
        url: url,
        destinationPageIndex: destinationPage
      )
    }

    return PDFPageExtraction(
      index: index,
      label: page.label ?? "",
      width: Double(pageBounds.width),
      height: Double(pageBounds.height),
      rotation: page.rotation,
      text: text,
      spans: spans,
      links: links
    )
  }

  private func rectRecord(_ rect: CGRect, pageBounds: CGRect) -> PDFRectRecord {
    PDFRectRecord(
      x: Double(rect.minX - pageBounds.minX),
      y: Double(pageBounds.maxY - rect.maxY),
      width: Double(rect.width),
      height: Double(rect.height)
    )
  }

  private func colorHex(_ color: UIColor?) -> String {
    guard let color else { return "" }
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return "" }
    return String(format: "#%02X%02X%02X%02X", Int(red * 255), Int(green * 255), Int(blue * 255), Int(alpha * 255))
  }

  private func extractMetadata(from document: PDFDocument) -> PDFDocumentMetadata {
    let attributes = document.documentAttributes ?? [:]
    let formatter = ISO8601DateFormatter()
    func string(_ key: PDFDocumentAttribute) -> String {
      (attributes[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
    func strings(_ key: PDFDocumentAttribute) -> [String] {
      attributes[key] as? [String] ?? []
    }
    func date(_ key: PDFDocumentAttribute) -> String {
      guard let value = attributes[key] as? Date else { return "" }
      return formatter.string(from: value)
    }
    return PDFDocumentMetadata(
      title: string(.titleAttribute),
      author: string(.authorAttribute),
      subject: string(.subjectAttribute),
      creator: string(.creatorAttribute),
      producer: string(.producerAttribute),
      keywords: strings(.keywordsAttribute),
      creationDate: date(.creationDateAttribute),
      modificationDate: date(.modificationDateAttribute)
    )
  }

  private func leadingLineFonts(_ attributed: NSAttributedString?, text: String) -> [Double] {
    guard let attributed = attributed else { return [] }
    var location = 0
    return text.components(separatedBy: "\n").map { line in
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
        result.append(PDFOutlineItem(
          title: title,
          pageIndex: pageIndex,
          level: level,
          x: destination.map { Double($0.point.x) } ?? 0,
          y: destination.map { Double($0.point.y) } ?? 0
        ))
      }
      walkOutline(child, document: document, level: level + 1, into: &result)
    }
  }
}
