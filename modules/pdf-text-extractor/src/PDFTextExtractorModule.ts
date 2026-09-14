import { NativeModule, requireNativeModule } from 'expo';

import type { PDFExtractionResult } from './PDFTextExtractor.types';

declare class PDFTextExtractorModule extends NativeModule {
  scanBookPage(): Promise<string | null>;
  extract(uri: string): Promise<PDFExtractionResult>;
  sentenceBoundaries(texts: string[]): Promise<number[][]>;
}

export default requireNativeModule<PDFTextExtractorModule>('PDFTextExtractor');
