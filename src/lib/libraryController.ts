import { Directory, File, Paths } from 'expo-file-system';
import { CHAPTER_VERSION, detectBookStructure } from './bookStructure';
import { contentFromParsed, defaultPreferences } from './bookContent';
import { sortLibrary } from './libraryOrder';
import { buildReadingOffsets, summaryAtPosition } from './readingPosition';
import { fileNameFromURI, friendlyErrorMessage, type LibraryServices } from './libraryServices';
import type { BookContent, BookSummary, ReaderPreferences, StoredBook } from '../types';

export type ActiveBook = { summary: BookSummary; content: BookContent; offsets: number[] };
export type BookSource = { uri: string; name?: string; mimeType?: string };
export type LibraryState = { books: BookSummary[]; preferences: ReaderPreferences; activeBook: ActiveBook | null; isLoading: boolean; isImporting: boolean; openingBookID: string | null; updatingChapterIDs: string[] };

export class LibraryController {
  state: LibraryState = { books: [], preferences: defaultPreferences, activeBook: null, isLoading: true, isImporting: false, openingBookID: null, updatingChapterIDs: [] };
  private booksRef = { current: [] as BookSummary[] };
  private activeBookRef = { current: null as ActiveBook | null };
  private contentCache = { current: new Map<string, { content: BookContent; offsets: number[] }>() };
  private openingRequest = { current: 0 };
  private chapterRequests = { current: new Set<string>() };
  private listeners = new Set<(state: LibraryState) => void>();
  constructor(private readonly services: LibraryServices) {}
  subscribe = (listener: (state: LibraryState) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set<K extends keyof LibraryState>(key: K, next: LibraryState[K] | ((previous: LibraryState[K]) => LibraryState[K])) {
    const value = typeof next === 'function' ? (next as (previous: LibraryState[K]) => LibraryState[K])(this.state[key]) : next;
    this.state = { ...this.state, [key]: value };
    this.listeners.forEach(listener => listener(this.state));
  }
  initialize = () => {
    let mounted = true;
    Promise.all([this.services.storage.loadLibrary(), this.services.storage.loadPreferences()]).then(([books, preferences]) => {
      if (!mounted) return;
      this.booksRef.current = books;
      this.set('books', books);
      this.set('preferences', preferences);
    }).catch(() => { if (mounted) this.services.notify('Couldn’t load your library', 'FlowReader will start with an empty library.'); })
      .finally(() => { if (mounted) this.set('isLoading', false); });
    return () => { mounted = false; };
  };
  private deleted = new Set<string>();
  private writes = new Map<string, Promise<void>>();
  readerSession = 0;

  private mutateBook(id: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.writes.get(id) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    this.writes.set(id, pending);
    void pending.finally(() => {
      if (this.writes.get(id) === pending) this.writes.delete(id);
    }).catch(() => undefined);
    return pending;
  }

  removeBook = async (book: BookSummary) => {
    this.deleted.add(book.id);
    this.openingRequest.current += 1;
    this.contentCache.current.delete(book.id);
    if (this.activeBookRef.current?.summary.id === book.id) this.showBook(null);
    this.saveLibrary(this.booksRef.current.filter(candidate => candidate.id !== book.id));
    await this.mutateBook(book.id, async () => {
      const content = await this.services.storage.loadBookContent(book.id);
      await this.services.storage.deleteBookData(book.id, this.services.resolveFile(book.id, content?.source?.format ?? book.format ?? 'pdf', content?.source?.uri ?? content?.pdfUri ?? ''));
    });
  };
  saveLibrary = (nextBooks: BookSummary[]) => {
    const ordered = sortLibrary(nextBooks);
    this.booksRef.current = ordered;
    this.set('books', ordered);
    void this.services.storage.persistLibrary(ordered).catch(() => {
      this.services.notify('Couldn’t save your place', 'Your position is still available in this session. Please check your device storage.');
    });
  };

  showBook = (nextBook: ActiveBook | null) => {
    const previous = this.activeBookRef.current;
    if (previous?.summary.id !== nextBook?.summary.id || previous?.content.layoutRevision !== nextBook?.content.layoutRevision) this.readerSession += 1;
    this.activeBookRef.current = nextBook;
    this.set('activeBook', nextBook);
  };

  refreshChapters = async (id: string, content: BookContent) => {
    if (content.source?.format === 'epub' || content.chapterVersion === CHAPTER_VERSION || this.chapterRequests.current.has(id) || this.services.platform !== 'ios') return;
    this.chapterRequests.current.add(id);
    this.set('updatingChapterIDs', (ids) => [...ids, id]);
    try {
      // iOS can relocate the app sandbox during an update. Resolve our owned
      // PDF from today's Documents directory instead of relying on its old URL.
      const extraction = await this.services.extract(this.services.resolvePDF(id, content.source?.uri ?? content.pdfUri ?? ''));
      if (!this.booksRef.current.some((book) => book.id === id)) return;
      const { chapters } = detectBookStructure(content.paragraphs, {
        sourcePages: extraction.pages,
        pageLineFonts: extraction.pageLineFonts,
        outlines: extraction.outlines,
        paragraphPages: content.paragraphPages,
      });
      await this.mutateBook(id, async () => {
        const cached = this.contentCache.current.get(id);
        if (this.deleted.has(id) || !cached || cached.content.layoutRevision !== content.layoutRevision) return;
        const metadata = { chapters, chapterVersion: CHAPTER_VERSION, layoutRevision: content.layoutRevision };
        await this.services.storage.storeChapterMetadata(id, metadata);
        if (this.deleted.has(id)) return;
        const nextContent = { ...cached.content, ...metadata };
        this.contentCache.current.set(id, { ...cached, content: nextContent });
        const current = this.activeBookRef.current;
        if (current?.summary.id === id && current.content.layoutRevision === content.layoutRevision) {
          this.showBook({ ...current, content: nextContent });
        }
      });
    } catch {
      // A failed metadata refresh never prevents reading the saved book.
    } finally {
      this.chapterRequests.current.delete(id);
      this.set('updatingChapterIDs', (ids) => ids.filter((candidate) => candidate !== id));
    }
  };

  importBookSource = async (source: BookSource, openAfterImport = false): Promise<BookSummary | null> => {
      if (this.state.isImporting) return null;

      let destination: File | undefined;
      let staged: File | undefined;
      let importedBookID: string | undefined;

      try {
        this.set('isImporting', true);

        const id = this.services.createID();
        importedBookID = id;
        const booksDirectory = new Directory(Paths.document, 'FlowReader', 'Books');
        booksDirectory.create({ idempotent: true, intermediates: true });

        staged = new File(booksDirectory, `${id}.import`);
        await new File(source.uri).copy(staged);
        const format = await this.services.detectFormat(staged.uri);
        destination = new File(booksDirectory, `${id}.${format}`);
        await staged.move(destination);

        if (format === 'pdf' && this.services.platform !== 'ios') {
          throw new Error('PDF text extraction is currently available on iOS only.');
        }

        const originalFileName = source.name?.trim() || fileNameFromURI(source.uri);
        const parsed = format === 'epub'
          ? await this.services.parseEpub(destination.uri, originalFileName, this.services.tokenize)
          : await this.services.parse(await this.services.extract(destination.uri), originalFileName, this.services.tokenize);
        if (!parsed.paragraphs.length) {
          throw new Error(format === 'pdf' ? 'This PDF has no readable text. Try running OCR on it first.' : 'This EPUB has no readable text. Import a text-focused edition.');
        }

        const content = contentFromParsed(parsed, destination.uri, this.services.createID(), format);
        const book: StoredBook = {
          ...content,
          id,
          format,
          title: parsed.metadata.title.value,
          originalFileName,
          importedAt: this.services.now(),
          lastReadAt: openAfterImport ? this.services.now() : undefined,
          currentParagraph: parsed.readingStart,
          paragraphCount: parsed.paragraphs.length,
        };
        const offsets = buildReadingOffsets(content);
        const summary = await this.services.storage.storeBook({ ...book, ...summaryAtPosition(book, content, offsets) });
        // Publish only after both content and the library index are durable. If
        // an existing reader moved while saving, include its latest position.
        while (true) {
          const previous = this.booksRef.current;
          const ordered = sortLibrary([summary, ...previous]);
          await this.services.storage.persistLibrary(ordered);
          if (this.booksRef.current !== previous) continue;
          this.booksRef.current = ordered;
          this.set('books', ordered);
          break;
        }
        this.contentCache.current.set(id, { content, offsets });

        if (openAfterImport) {
          this.showBook({ summary, content, offsets });
        }

        return summary;
      } catch (error) {
        if (importedBookID) {
          try { await this.services.storage.deleteBookData(importedBookID, destination?.uri); } catch { /* Report the original import error. */ }
        }
        try { if (staged?.exists) staged.delete(); } catch { /* Best-effort cleanup after a failed copy. */ }
        this.services.notify('Couldn’t import book', friendlyErrorMessage(error));
        return null;
      } finally {
        this.set('isImporting', false);
      }
    };

  openBook = async (book: BookSummary) => {
    const request = ++this.openingRequest.current;
    this.set('openingBookID', book.id);
    try {
      let cached = this.contentCache.current.get(book.id);
      if (!cached) {
        const content = await this.services.storage.loadBookContent(book.id);
        if (!content?.paragraphs.length) throw new Error('The saved book data could not be found.');
        cached = { content, offsets: buildReadingOffsets(content) };
        this.contentCache.current.set(book.id, cached);
      }
      if (request !== this.openingRequest.current || this.deleted.has(book.id)) {
        if (this.deleted.has(book.id)) this.contentCache.current.delete(book.id);
        return;
      }
      const latest = this.booksRef.current.find((candidate) => candidate.id === book.id);
      if (!latest) return;
      const { content, offsets } = cached;
      const summary = summaryAtPosition({ ...latest, lastReadAt: this.services.now() }, content, offsets);
      this.saveLibrary(this.booksRef.current.map((candidate) => candidate.id === book.id ? summary : candidate));
      this.showBook({ summary, content, offsets });
      // Let the cached reader paint before refreshing only its chapter metadata.
      this.services.schedule(() => { void this.refreshChapters(book.id, content); }, 250);
    } catch (error) {
      this.services.notify('Couldn’t open book', friendlyErrorMessage(error));
    } finally {
      if (request === this.openingRequest.current) this.set('openingBookID', null);
    }
  };

  updateProgress = (bookID: string, paragraph: number, session = this.readerSession) => {
    const current = this.activeBookRef.current;
    if (!current || current.summary.id !== bookID || session !== this.readerSession || this.deleted.has(bookID)) return;
    const summary = summaryAtPosition({ ...current.summary, lastReadAt: this.services.now() }, current.content, current.offsets, paragraph);
    this.activeBookRef.current = { ...current, summary };
    this.set('activeBook', this.activeBookRef.current);
    this.saveLibrary(this.booksRef.current.map((book) => book.id === bookID ? summary : book));
  };

  updatePreferences = (nextPreferences: ReaderPreferences) => {
    this.set('preferences', nextPreferences);
    void this.services.storage.persistPreferences(nextPreferences);
  };

  closeReader = (paragraph: number, session = this.readerSession) => {
      if (session !== this.readerSession) return;
      this.openingRequest.current += 1;
      const current = this.activeBookRef.current;
      if (current) this.updateProgress(current.summary.id, paragraph);
      this.showBook(null);
    };

}
