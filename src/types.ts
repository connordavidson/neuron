export type ReaderThemeName = 'paper' | 'sepia' | 'night';

export type BookSummary = {
  id: string;
  title: string;
  originalFileName: string;
  importedAt: string;
  lastReadAt?: string;
  paragraphCount: number;
  currentParagraph: number;
  readingStart?: number;
  readingProgress?: number;
  currentSourcePage?: number;
};

export type Chapter = {
  paragraphIndex: number;
  title: string;
  pageIndex?: number;
  level?: number;
  kind?: 'chapter' | 'part' | 'section' | 'frontMatter' | 'backMatter';
};

export type BookContent = {
  pdfUri: string;
  paragraphs: string[];
  chapters: Chapter[];
  readingStart: number;
  parserVersion?: number;
  paragraphPages?: number[];
  chapterVersion?: number;
};

export type StoredBook = BookSummary & BookContent;

export type ReaderPreferences = {
  fontSize: number;
  theme: ReaderThemeName;
};
