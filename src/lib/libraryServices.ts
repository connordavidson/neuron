import { Platform } from 'react-native';
import PDFTextExtractor from '../../modules/pdf-text-extractor/src/PDFTextExtractorModule';
import { parseEbook } from './contentParser';
import { resolveBookPDF } from './bookFiles';
import { sentenceSpans } from './sentences';
import * as storage from './storage';
type PDFTextExtractorModuleWithTokenizer = typeof PDFTextExtractor & { sentenceBoundaries?: (texts: string[]) => Promise<number[][]> };
export const libraryServices = { storage, extract: (uri: string) => PDFTextExtractor.extract(uri), parse: parseEbook, tokenize: tokenizeOnDevice, resolvePDF: resolveBookPDF, now: () => new Date().toISOString(), createID, schedule: (work: () => void, delay: number) => setTimeout(work, delay), platform: Platform.OS };
export type LibraryServices = typeof libraryServices & { notify: (title: string, message: string) => void };
export function createID(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function fileNameFromURI(uri: string): string {
  const path = uri.split(/[?#]/, 1)[0] ?? uri;
  const rawName = path.split('/').pop() ?? 'Imported PDF.pdf';
  try {
    return decodeURIComponent(rawName) || 'Imported PDF.pdf';
  } catch {
    return rawName || 'Imported PDF.pdf';
  }
}

export function friendlyErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something unexpected happened. Please try another PDF.';
}

async function tokenizeOnDevice(texts: string[]): Promise<number[][]> {
  // Physical phones can briefly run an older development binary while the JS
  // bundle has already refreshed. Keep imports functional until it is rebuilt.
  try {
    const native = (PDFTextExtractor as PDFTextExtractorModuleWithTokenizer).sentenceBoundaries;
    if (typeof native === 'function') return await native.call(PDFTextExtractor, texts);
  } catch {
    // Apply the same deterministic boundary protections locally.
  }
  return texts.map((text) => sentenceSpans(text).map((span) => span.start + span.text.length));
}
