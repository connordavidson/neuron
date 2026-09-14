import type { PDFExtractionResult } from './PDFTextExtractor.types';

export default {
  async scanBookPage(): Promise<string | null> {
    throw new Error('Page scanning is currently available on iOS only.');
  },
  async sentenceBoundaries(_texts: string[]): Promise<number[][]> {
    throw new Error('Sentence analysis is currently available on iOS only.');
  },
  async extract(_uri: string): Promise<PDFExtractionResult> {
    throw new Error('PDF text extraction is currently available on iOS only.');
  },
};
