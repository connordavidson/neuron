export type ReaderThemeName = 'paper' | 'sepia' | 'night';
export type BookFormat = 'pdf' | 'epub';
export type BookSourceFile = { format: BookFormat; uri: string };

export type Evidence = {
  confidence: number;
  evidence: string[];
};

export type SourceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type AnchorContext = {
  sourceStart: number;
  sourceEnd: number;
  contextHash: string;
  contextText?: string;
};

export type PDFSourceAnchor = AnchorContext & { format?: 'pdf'; pageIndex: number; pageLabel?: string };
export type EPUBSourceAnchor = AnchorContext & {
  format: 'epub';
  documentPath: string;
  spineIndex: number;
  elementId?: string;
  pageIndex?: never;
  pageLabel?: never;
};
export type SourceAnchor = PDFSourceAnchor | EPUBSourceAnchor;

export type MetadataValue = Evidence & { value: string };

export type BookMetadata = {
  title: MetadataValue;
  subtitle?: MetadataValue;
  authors: MetadataValue[];
  publisher?: MetadataValue;
  language?: MetadataValue;
  identifiers: Array<MetadataValue & { scheme: 'doi' | 'isbn' | 'other' }>;
};

export type SemanticSectionKind =
  | 'cover'
  | 'titlePage'
  | 'copyright'
  | 'dedication'
  | 'contents'
  | 'foreword'
  | 'preface'
  | 'acknowledgments'
  | 'introduction'
  | 'part'
  | 'chapter'
  | 'section'
  | 'conclusion'
  | 'epilogue'
  | 'appendix'
  | 'glossary'
  | 'notes'
  | 'bibliography'
  | 'index'
  | 'aboutAuthor'
  | 'colophon'
  | 'unknownFront'
  | 'body'
  | 'unknownBack';

export type ContentBlockKind =
  | 'heading'
  | 'prose'
  | 'footnote'
  | 'caption'
  | 'table'
  | 'reference'
  | 'decorative';

export type ContentBlock = Evidence & {
  id: string;
  kind: ContentBlockKind;
  text: string;
  anchor: SourceAnchor;
  bounds?: SourceRect;
  fontSize?: number;
  fontName?: string;
  sectionId?: string;
};

export type ContextualSupplement = Evidence & {
  id: string;
  kind: Extract<ContentBlockKind, 'footnote' | 'caption' | 'table' | 'reference'>;
  text: string;
  anchor: SourceAnchor;
  relatedBlockIds: string[];
  readingPage?: number;
};

export type ReadingUnit = {
  id: string;
  text: string;
  sentenceCount: number;
  sectionId?: string;
  heading?: string;
  anchor: SourceAnchor;
  endAnchor: SourceAnchor;
  sourcePages: number[];
  wordCount: number;
  supplementIds: string[];
  sentences: Array<{ text: string; anchor: SourceAnchor; endAnchor: SourceAnchor }>;
};

export type SectionNode = Evidence & {
  id: string;
  title: string;
  kind: SemanticSectionKind;
  level: number;
  parentId?: string;
  startBlock: number;
  endBlock: number;
  startUnit: number;
  endUnit: number;
  startPage?: number;
  endPage?: number;
  linear?: boolean;
  anchor: SourceAnchor;
};

export type PDFSectionNode = SectionNode & { startPage: number; endPage: number; anchor: PDFSourceAnchor };

export type ParseDiagnostics = {
  parserVersion: number;
  warnings: string[];
  suppressedNavigation: Array<Evidence & { title: string; pageIndex: number; reason: string }>;
  counts: {
    sourcePages: number;
    sourceSpans: number;
    blocks: number;
    readingUnits: number;
    supplements: number;
    sections: number;
    removedFurniture: number;
  };
};

export type BookSummary = {
  id: string;
  format?: BookFormat;
  title: string;
  originalFileName: string;
  importedAt: string;
  lastReadAt?: string;
  paragraphCount: number;
  currentParagraph: number;
  readingStart?: number;
  readingProgress?: number;
  currentSourcePage?: number;
  currentAnchor?: SourceAnchor;
  parserVersion?: number;
  parseConfidence?: number;
};

export type Chapter = {
  paragraphIndex: number;
  title: string;
  pageIndex?: number;
  level?: number;
  kind?: 'chapter' | 'part' | 'section' | 'frontMatter' | 'backMatter';
  sectionId?: string;
  confidence?: number;
};

export type BookContent = {
  source?: BookSourceFile;
  /** Read compatibility for books saved before format-aware sources. */
  pdfUri?: string;
  paragraphs: string[];
  chapters: Chapter[];
  readingStart: number;
  parserVersion?: number;
  paragraphPages?: number[];
  chapterVersion?: number;
  metadata?: BookMetadata;
  sections?: SectionNode[];
  blocks?: ContentBlock[];
  readingUnits?: ReadingUnit[];
  supplements?: ContextualSupplement[];
  diagnostics?: ParseDiagnostics;
  layoutRevision?: string;
};

export type StoredBook = BookSummary & BookContent;

export type ReaderPreferences = {
  fontSize: number;
  theme: ReaderThemeName;
};
