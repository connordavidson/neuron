export type PDFOutlineItem = {
  title: string;
  pageIndex: number;
  level: number;
  x?: number;
  y?: number;
};

export type PDFRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PDFTextSpan = {
  text: string;
  sourceStart: number;
  sourceEnd: number;
  lineIndex: number;
  bounds: PDFRect;
  fontName: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color?: string;
};

export type PDFLink = {
  bounds: PDFRect;
  url?: string;
  destinationPageIndex?: number;
};

export type PDFPageExtraction = {
  index: number;
  label?: string;
  width: number;
  height: number;
  rotation: number;
  text: string;
  spans: PDFTextSpan[];
  links: PDFLink[];
};

export type PDFDocumentMetadata = {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  keywords?: string[];
  creationDate?: string;
  modificationDate?: string;
};

export type PDFExtractionResult = {
  title: string;
  pages: string[];
  outlines?: PDFOutlineItem[];
  pageLineFonts?: number[][];
  structuredPages?: PDFPageExtraction[];
  metadata?: PDFDocumentMetadata;
};
