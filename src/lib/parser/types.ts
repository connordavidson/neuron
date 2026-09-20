import type { SourceRect, ContentBlock, Evidence, SemanticSectionKind, PDFSourceAnchor } from '../../types';

export type LayoutLine = {
  id: string;
  pageIndex: number;
  pageLabel?: string;
  lineIndex: number;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  bounds: SourceRect;
  pageWidth: number;
  pageHeight: number;
  fontName: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  centered: boolean;
};

export type InternalBlock = ContentBlock & {
  anchor: PDFSourceAnchor;
  pageHeight: number;
  pageWidth: number;
  centered: boolean;
  bold: boolean;
  italic: boolean;
};

export type SectionCandidate = Evidence & {
  title: string;
  kind: SemanticSectionKind;
  pageIndex: number;
  blockIndex: number;
  level: number;
  source: 'outline' | 'heading' | 'toc' | 'page';
};
