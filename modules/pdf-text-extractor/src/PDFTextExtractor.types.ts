export type PDFOutlineItem = {
  title: string;
  pageIndex: number;
  level: number;
};

export type PDFExtractionResult = {
  title: string;
  pages: string[];
  outlines?: PDFOutlineItem[];
  pageLineFonts?: number[][];
};
