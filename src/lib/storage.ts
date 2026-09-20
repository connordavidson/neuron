import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { defaultPreferences, normalizeStoredContent } from './bookContent';
import { sortLibrary } from './libraryOrder';
import { PARAGRAPH_PARSER_VERSION } from './paragraphize';
import type { BookContent, BookSummary, ReaderPreferences, StoredBook } from '../types';

const LIBRARY_KEY = 'neuron.library.v1';
const PREFERENCES_KEY = 'neuron.preferences.v1';
const bookContentKey = (id: string) => `neuron.book.${id}.v1`;
const chapterMetadataKey = (id: string) => `neuron.chapters.${id}.v1`;
let libraryWriteQueue = Promise.resolve();


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
    source, pdfUri, paragraphs, chapters, chapterVersion, paragraphPages, parserVersion,
    metadata, sections, blocks, readingUnits, supplements, diagnostics, layoutRevision, ...summary
  } = book;
  const readingStart = book.readingStart ?? 0;
  const content: BookContent = {
    source,
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

  return normalizeStoredContent(serialized, chapterData);
}

export async function storeChapterMetadata(id: string, content: Pick<BookContent, 'chapters' | 'chapterVersion' | 'layoutRevision'>): Promise<void> {
  await AsyncStorage.setItem(chapterMetadataKey(id), JSON.stringify(content));
}

export async function deleteBookData(id: string, sourceUri?: string): Promise<void> {
  await AsyncStorage.removeItem(bookContentKey(id));
  await AsyncStorage.removeItem(chapterMetadataKey(id));
  if (!sourceUri) return;

  try {
    const file = new File(sourceUri);
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
