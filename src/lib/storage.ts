import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { detectBookStructure } from './bookStructure';
import { sortLibrary } from './libraryOrder';
import { PARAGRAPH_PARSER_VERSION, repairQuotationBoundaries } from './paragraphize';
import type { BookContent, BookSummary, ReaderPreferences, StoredBook } from '../types';

const LIBRARY_KEY = 'flowreader.library.v1';
const PREFERENCES_KEY = 'flowreader.preferences.v1';
const bookContentKey = (id: string) => `flowreader.book.${id}.v1`;
const chapterMetadataKey = (id: string) => `flowreader.chapters.${id}.v1`;
let libraryWriteQueue = Promise.resolve();

const defaultPreferences: ReaderPreferences = {
  fontSize: 24,
  theme: 'paper',
};

export async function loadLibrary(): Promise<BookSummary[]> {
  const serialized = await AsyncStorage.getItem(LIBRARY_KEY);
  if (!serialized) return [];

  try {
    const books = JSON.parse(serialized) as BookSummary[];
    return sortLibrary(books);
  } catch {
    return [];
  }
}

export async function persistLibrary(books: BookSummary[]): Promise<void> {
  libraryWriteQueue = libraryWriteQueue
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(books)));
  await libraryWriteQueue;
}

export async function storeBook(book: StoredBook): Promise<BookSummary> {
  const {
    pdfUri, paragraphs, chapters, chapterVersion, paragraphPages, parserVersion,
    metadata, sections, blocks, readingUnits, supplements, diagnostics, layoutRevision, ...summary
  } = book;
  const readingStart = book.readingStart ?? 0;
  const content: BookContent = {
    chapters,
    chapterVersion,
    parserVersion: parserVersion ?? PARAGRAPH_PARSER_VERSION,
    pdfUri,
    paragraphs,
    paragraphPages,
    readingStart,
    metadata,
    sections,
    blocks,
    readingUnits,
    supplements,
    diagnostics,
    layoutRevision,
  };
  await storeBookContent(book.id, content);
  return { ...summary, parserVersion: content.parserVersion };
}

export async function storeBookContent(id: string, content: BookContent): Promise<void> {
  await AsyncStorage.setItem(bookContentKey(id), JSON.stringify(content));
}

export async function loadBookContent(id: string): Promise<BookContent | null> {
  const [serialized, chapterData] = await Promise.all([
    AsyncStorage.getItem(bookContentKey(id)), AsyncStorage.getItem(chapterMetadataKey(id)),
  ]);
  if (!serialized) return null;

  try {
    const parsed = JSON.parse(serialized) as Partial<BookContent>;
    let chapterMetadata: Partial<BookContent> = {};
    try { chapterMetadata = chapterData ? JSON.parse(chapterData) : {}; } catch { /* Keep original metadata. */ }
    // A full reparse is authoritative over an equal/older navigation-only scan.
    // Otherwise reopening could replace newly repaired chapters with stale ones.
    if ((chapterMetadata.chapterVersion ?? 0) <= (parsed.chapterVersion ?? 0)) chapterMetadata = {};
    const paragraphs = repairQuotationBoundaries(Array.isArray(parsed.paragraphs) ? parsed.paragraphs : []);
    const storedChapters = Array.isArray(parsed.chapters) ? parsed.chapters : undefined;
    const storedReadingStart =
      typeof parsed.readingStart === 'number' ? parsed.readingStart : undefined;
    const detected = storedChapters && storedReadingStart != null ? null : detectBookStructure(paragraphs);
    const content: BookContent = {
      chapters: Array.isArray(chapterMetadata.chapters) ? chapterMetadata.chapters : storedChapters ?? detected?.chapters ?? [],
      chapterVersion: chapterMetadata.chapterVersion ?? parsed.chapterVersion,
      parserVersion:
        typeof parsed.parserVersion === 'number' ? parsed.parserVersion : undefined,
      pdfUri: parsed.pdfUri ?? '',
      paragraphs,
      paragraphPages: Array.isArray(parsed.paragraphPages) && parsed.paragraphPages.length === paragraphs.length
        ? parsed.paragraphPages : undefined,
      readingStart: storedReadingStart ?? detected?.readingStart ?? 0,
    };
    if (parsed.metadata) content.metadata = parsed.metadata;
    if (Array.isArray(parsed.sections)) content.sections = parsed.sections;
    if (Array.isArray(parsed.blocks)) content.blocks = parsed.blocks;
    if (Array.isArray(parsed.readingUnits) && parsed.readingUnits.length === paragraphs.length) content.readingUnits = parsed.readingUnits;
    if (Array.isArray(parsed.supplements)) content.supplements = parsed.supplements;
    if (parsed.diagnostics) content.diagnostics = parsed.diagnostics;
    if (typeof parsed.layoutRevision === 'string') content.layoutRevision = parsed.layoutRevision;
    return content;
  } catch {
    return null;
  }
}

export async function storeChapterMetadata(id: string, content: Pick<BookContent, 'chapters' | 'chapterVersion'>): Promise<void> {
  await AsyncStorage.setItem(chapterMetadataKey(id), JSON.stringify(content));
}

export async function deleteBookData(id: string, pdfUri?: string): Promise<void> {
  await AsyncStorage.removeItem(bookContentKey(id));
  await AsyncStorage.removeItem(chapterMetadataKey(id));
  if (!pdfUri) return;

  try {
    const file = new File(pdfUri);
    if (file.exists) file.delete();
  } catch {
    // A missing cached file should never prevent the library entry from being removed.
  }
}

export async function loadPreferences(): Promise<ReaderPreferences> {
  const serialized = await AsyncStorage.getItem(PREFERENCES_KEY);
  if (!serialized) return defaultPreferences;

  try {
    return { ...defaultPreferences, ...(JSON.parse(serialized) as Partial<ReaderPreferences>) };
  } catch {
    return defaultPreferences;
  }
}

export async function persistPreferences(preferences: ReaderPreferences): Promise<void> {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}
