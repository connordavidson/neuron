import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Modal, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import PDFTextExtractor from './modules/pdf-text-extractor/src/PDFTextExtractorModule';
import { LibraryScreen } from './src/components/LibraryScreen';
import { ReaderScreen } from './src/components/ReaderScreen';
import { CHAPTER_VERSION, detectBookStructure, detectSourceChapters } from './src/lib/bookStructure';
import { inferBookTitle } from './src/lib/bookTitle';
import { sortLibrary } from './src/lib/libraryOrder';
import { buildReadingOffsets, summaryAtPosition } from './src/lib/readingPosition';
import {
  PARAGRAPH_PARSER_VERSION,
  paragraphizeWithTokenizer,
} from './src/lib/paragraphize';
import { sentenceSpans } from './src/lib/sentences';
import {
  deleteBookData,
  loadBookContent,
  loadLibrary,
  loadPreferences,
  persistLibrary,
  persistPreferences,
  storeBook,
  storeChapterMetadata,
} from './src/lib/storage';
import type {
  BookContent,
  BookSummary,
  ReaderPreferences,
  StoredBook,
} from './src/types';

type ActiveBook = {
  summary: BookSummary;
  content: BookContent;
  offsets: number[];
};

type PDFSource = {
  uri: string;
  name?: string;
};

type PDFTextExtractorModuleWithTokenizer = typeof PDFTextExtractor & {
  sentenceBoundaries?: (texts: string[]) => Promise<number[][]>;
};

const initialPreferences: ReaderPreferences = { fontSize: 24, theme: 'paper' };

export default function App() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [activeBook, setActiveBook] = useState<ActiveBook | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [openingBookID, setOpeningBookID] = useState<string | null>(null);
  const handledIncomingURLs = useRef(new Set<string>());
  const booksRef = useRef<BookSummary[]>([]);
  const activeBookRef = useRef<ActiveBook | null>(null);
  const contentCache = useRef(new Map<string, { content: BookContent; offsets: number[] }>());
  const openingRequest = useRef(0);
  const chapterRequests = useRef(new Set<string>());
  const [updatingChapterIDs, setUpdatingChapterIDs] = useState<string[]>([]);

  const saveLibrary = useCallback((nextBooks: BookSummary[]) => {
    const ordered = sortLibrary(nextBooks);
    booksRef.current = ordered;
    setBooks(ordered);
    void persistLibrary(ordered).catch(() => {
      Alert.alert('Couldn’t save your place', 'Your position is still available in this session. Please check your device storage.');
    });
  }, []);

  const showBook = useCallback((nextBook: ActiveBook | null) => {
    activeBookRef.current = nextBook;
    setActiveBook(nextBook);
  }, []);

  const refreshChapters = useCallback(async (id: string, content: BookContent) => {
    if (content.chapterVersion === CHAPTER_VERSION || chapterRequests.current.has(id) || Platform.OS !== 'ios') return;
    chapterRequests.current.add(id);
    setUpdatingChapterIDs((ids) => [...ids, id]);
    try {
      // iOS can relocate the app sandbox during an update. Resolve our owned
      // PDF from today's Documents directory instead of relying on its old URL.
      const localPDF = new File(Paths.document, 'FlowReader', 'Books', `${id}.pdf`);
      const extraction = await PDFTextExtractor.extract(localPDF.exists ? localPDF.uri : content.pdfUri);
      if (!booksRef.current.some((book) => book.id === id)) return;
      const { chapters } = detectBookStructure(content.paragraphs, {
        sourcePages: extraction.pages,
        pageLineFonts: extraction.pageLineFonts,
        outlines: extraction.outlines,
        paragraphPages: content.paragraphPages,
      });
      const metadata = { chapters, chapterVersion: CHAPTER_VERSION };
      await storeChapterMetadata(id, metadata);
      const cached = contentCache.current.get(id);
      if (!cached || !booksRef.current.some((book) => book.id === id)) return;
      const nextContent = { ...cached.content, ...metadata };
      contentCache.current.set(id, { ...cached, content: nextContent });
      const current = activeBookRef.current;
      if (current?.summary.id === id) {
        // Update only navigation metadata. Keep the latest bookmark, progress,
        // paragraph array and reader instance intact, even after a long scan.
        showBook({ ...current, content: nextContent });
      }
    } catch {
      // A failed metadata refresh never prevents reading the saved book.
    } finally {
      chapterRequests.current.delete(id);
      setUpdatingChapterIDs((ids) => ids.filter((candidate) => candidate !== id));
    }
  }, [showBook]);

  useEffect(() => {
    let isMounted = true;

    Promise.all([loadLibrary(), loadPreferences()])
      .then(([storedBooks, storedPreferences]) => {
        if (!isMounted) return;
        booksRef.current = storedBooks;
        setBooks(storedBooks);
        setPreferences(storedPreferences);
      })
      .catch(() => {
        if (isMounted) {
          Alert.alert('Couldn’t load your library', 'FlowReader will start with an empty library.');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const importPDFSource = useCallback(
    async (source: PDFSource, openAfterImport = false): Promise<BookSummary | null> => {
      if (isImporting) return null;

      let destination: File | undefined;
      let importedBookID: string | undefined;

      try {
        setIsImporting(true);

        const id = createID();
        importedBookID = id;
        const booksDirectory = new Directory(Paths.document, 'FlowReader', 'Books');
        booksDirectory.create({ idempotent: true, intermediates: true });

        destination = new File(booksDirectory, `${id}.pdf`);
        await new File(source.uri).copy(destination);

        if (Platform.OS !== 'ios') {
          throw new Error('PDF text extraction is currently available on iOS only.');
        }

        const extraction = await PDFTextExtractor.extract(destination.uri);
        const sourceChapters = detectSourceChapters(extraction.pages, extraction.outlines, extraction.pageLineFonts);
        const paragraphRecords = await paragraphizeWithTokenizer(extraction.pages, sourceChapters,
          async (texts) => {
            // Physical phones can briefly run an older development binary while
            // the JS bundle has already refreshed. Fall back locally until the
            // native Natural Language method is available.
            try {
              const native = (PDFTextExtractor as PDFTextExtractorModuleWithTokenizer).sentenceBoundaries;
              if (typeof native === 'function') return await native.call(PDFTextExtractor, texts);
            } catch {
              // Use the same guarded parser below when the old binary throws.
            }
            return texts.map((text) => sentenceSpans(text).map((span) => span.start + span.text.length));
          });
        const paragraphs = paragraphRecords.map(({ text }) => text);
        if (!paragraphs.length) {
          throw new Error('This PDF has no readable text. Try running OCR on it first.');
        }

        const originalFileName = source.name?.trim() || fileNameFromURI(source.uri);
        const title = inferBookTitle(extraction.title, originalFileName, extraction.pages);
        const structure = detectBookStructure(paragraphs, {
          sourceChapters,
          sourcePages: extraction.pages,
          chapterMarkers: paragraphRecords.flatMap(({ heading }, paragraphIndex) =>
            heading ? [{ paragraphIndex, title: heading }] : [],
          ),
          outlines: extraction.outlines,
          paragraphPages: paragraphRecords.map(({ pageIndex }) => pageIndex),
        });
        const book: StoredBook = {
          currentParagraph: structure.readingStart,
          id,
          importedAt: new Date().toISOString(),
          lastReadAt: openAfterImport ? new Date().toISOString() : undefined,
          originalFileName,
          paragraphCount: paragraphs.length,
          paragraphs,
          paragraphPages: paragraphRecords.map(({ pageIndex }) => pageIndex),
          parserVersion: PARAGRAPH_PARSER_VERSION,
          pdfUri: destination.uri,
          chapters: structure.chapters,
          chapterVersion: CHAPTER_VERSION,
          readingStart: structure.readingStart,
          title,
        };

        const offsets = buildReadingOffsets(book);
        const summary = await storeBook({ ...book, ...summaryAtPosition(book, book, offsets) });
        const content: BookContent = {
          chapters: book.chapters,
          chapterVersion: CHAPTER_VERSION,
          pdfUri: book.pdfUri,
          paragraphs,
          paragraphPages: book.paragraphPages,
          parserVersion: PARAGRAPH_PARSER_VERSION,
          readingStart: structure.readingStart,
        };
        contentCache.current.set(id, { content, offsets });
        saveLibrary([summary, ...booksRef.current]);

        if (openAfterImport) {
          showBook({ summary, content, offsets });
        }

        return summary;
      } catch (error) {
        if (importedBookID) await deleteBookData(importedBookID, destination?.uri);
        Alert.alert('Couldn’t import PDF', friendlyErrorMessage(error));
        return null;
      } finally {
        setIsImporting(false);
      }
    },
    [isImporting, saveLibrary, showBook],
  );

  const importIncomingURL = useCallback(
    async (url: string) => {
      if (!url.toLowerCase().startsWith('file://')) return;
      if (handledIncomingURLs.current.has(url)) return;
      handledIncomingURLs.current.add(url);

      await importPDFSource(
        {
          name: fileNameFromURI(url),
          uri: url,
        },
        true,
      );
    },
    [importPDFSource],
  );

  useEffect(() => {
    if (isLoading) return;

    let isMounted = true;
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void importIncomingURL(url);
    });

    Linking.getInitialURL()
      .then((url) => {
        if (isMounted && url) void importIncomingURL(url);
      })
      .catch(() => {
        // An unavailable initial URL should not interrupt the normal library flow.
      });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [importIncomingURL, isLoading]);

  const importPDF = useCallback(async () => {
    if (isImporting) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: 'application/pdf',
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) throw new Error('No PDF was selected.');
      await importPDFSource({ name: asset.name, uri: asset.uri });
    } catch (error) {
      Alert.alert('Couldn’t import PDF', friendlyErrorMessage(error));
    }
  }, [importPDFSource, isImporting]);

  const openBook = useCallback(async (book: BookSummary) => {
    const request = ++openingRequest.current;
    setOpeningBookID(book.id);
    try {
      let cached = contentCache.current.get(book.id);
      if (!cached) {
        const content = await loadBookContent(book.id);
        if (!content?.paragraphs.length) throw new Error('The saved book data could not be found.');
        cached = { content, offsets: buildReadingOffsets(content) };
        contentCache.current.set(book.id, cached);
      }
      if (request !== openingRequest.current) return;
      const latest = booksRef.current.find((candidate) => candidate.id === book.id);
      if (!latest) return;
      const { content, offsets } = cached;
      const summary = summaryAtPosition({ ...latest, lastReadAt: new Date().toISOString() }, content, offsets);
      saveLibrary(booksRef.current.map((candidate) => candidate.id === book.id ? summary : candidate));
      showBook({ summary, content, offsets });
      // Let the cached reader paint before refreshing only its chapter metadata.
      setTimeout(() => { void refreshChapters(book.id, content); }, 250);
    } catch (error) {
      Alert.alert('Couldn’t open book', friendlyErrorMessage(error));
    } finally {
      if (request === openingRequest.current) setOpeningBookID(null);
    }
  }, [refreshChapters, saveLibrary, showBook]);

  const confirmDeleteBook = useCallback(
    (book: BookSummary) => {
      Alert.alert(
        'Remove this book?',
        `“${book.title}” and your reading progress will be deleted from this device.`,
        [
          { style: 'cancel', text: 'Cancel' },
          {
            style: 'destructive',
            text: 'Remove',
            onPress: () => {
              void (async () => {
                const content = await loadBookContent(book.id);
                await deleteBookData(book.id, content?.pdfUri);
                contentCache.current.delete(book.id);
                saveLibrary(booksRef.current.filter((candidate) => candidate.id !== book.id));
              })();
            },
          },
        ],
      );
    },
    [saveLibrary],
  );

  const updateProgress = useCallback((bookID: string, paragraph: number) => {
    const current = activeBookRef.current;
    if (!current || current.summary.id !== bookID) return;
    const summary = summaryAtPosition({ ...current.summary, lastReadAt: new Date().toISOString() }, current.content, current.offsets, paragraph);
    activeBookRef.current = { ...current, summary };
    setActiveBook(activeBookRef.current);
    saveLibrary(booksRef.current.map((book) => book.id === bookID ? summary : book));
  }, [saveLibrary]);

  const updatePreferences = useCallback((nextPreferences: ReaderPreferences) => {
    setPreferences(nextPreferences);
    void persistPreferences(nextPreferences);
  }, []);

  const closeReader = useCallback(
    (paragraph: number) => {
      const current = activeBookRef.current;
      if (current) updateProgress(current.summary.id, paragraph);
      showBook(null);
    },
    [showBook, updateProgress],
  );

  return (
    <>
      <LibraryScreen
        books={books}
        isImporting={isImporting}
        isLoading={isLoading}
        onDeleteBook={confirmDeleteBook}
        onImport={importPDF}
        onOpenBook={openBook}
        openingBookID={openingBookID}
      />

      <Modal
        animationType="slide"
        onRequestClose={() => closeReader(activeBookRef.current?.summary.currentParagraph ?? 0)}
        presentationStyle="fullScreen"
        visible={activeBook !== null}
      >
        {activeBook ? (
          <ReaderScreen
            key={activeBook.summary.id}
            book={activeBook.summary}
            content={activeBook.content}
            updatingChapters={updatingChapterIDs.includes(activeBook.summary.id)}
            onClose={closeReader}
            onPreferencesChange={updatePreferences}
            onProgressChange={(paragraph) => updateProgress(activeBook.summary.id, paragraph)}
            preferences={preferences}
          />
        ) : null}
      </Modal>
    </>
  );
}

function createID(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fileNameFromURI(uri: string): string {
  const path = uri.split(/[?#]/, 1)[0] ?? uri;
  const rawName = path.split('/').pop() ?? 'Imported PDF.pdf';
  try {
    return decodeURIComponent(rawName) || 'Imported PDF.pdf';
  } catch {
    return rawName || 'Imported PDF.pdf';
  }
}

function friendlyErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something unexpected happened. Please try another PDF.';
}
