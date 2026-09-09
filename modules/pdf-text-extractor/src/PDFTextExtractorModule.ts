import { NativeModule, requireNativeModule } from 'expo';

import type { PDFExtractionResult } from './PDFTextExtractor.types';

declare class PDFTextExtractorModule extends NativeModule {
  extract(uri: string): Promise<PDFExtractionResult>;
}

export default requireNativeModule<PDFTextExtractorModule>('PDFTextExtractor');
