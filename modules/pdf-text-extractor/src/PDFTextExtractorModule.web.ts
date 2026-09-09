import type { PDFExtractionResult } from './PDFTextExtractor.types';

export default {
  async extract(_uri: string): Promise<PDFExtractionResult> {
    throw new Error('PDF text extraction is currently available on iOS only.');
  },
};
