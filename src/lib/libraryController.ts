import { Directory, File, Paths } from 'expo-file-system';
import { CHAPTER_VERSION, detectBookStructure } from './bookStructure';
import { CONTENT_PARSER_VERSION, remapReadingPosition, sourceAnchorForLegacy } from './contentParser';
import { contentFromParsed, defaultPreferences } from './bookContent';
import { sortLibrary } from './libraryOrder';
import { buildReadingOffsets, summaryAtPosition } from './readingPosition';
import { fileNameFromURI, friendlyErrorMessage, type LibraryServices } from './libraryServices';
import type { BookContent, BookSummary, ReaderPreferences, StoredBook } from '../types';

export type ActiveBook = { summary: BookSummary; content: BookContent; offsets: number[] };
export type PDFSource = { uri: string; name?: string };
export type LibraryState = { books: BookSummary[]; preferences: ReaderPreferences; activeBook: ActiveBook | null; isLoading: boolean; isImporting: boolean; openingBookID: string | null; improvingBookID: string | null; updatingChapterIDs: string[] };

export class LibraryController {
  state: LibraryState = { books: [], preferences: defaultPreferences, activeBook: null, isLoading: true, isImporting: false, openingBookID: null, improvingBookID: null, updatingChapterIDs: [] };
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
      await this.services.storage.deleteBookData(book.id, this.services.resolvePDF(book.id, content?.pdfUri ?? ''));
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
    if (content.chapterVersion === CHAPTER_VERSION || this.chapterRequests.current.has(id) || this.services.platform !== 'ios') return;
    this.chapterRequests.current.add(id);
    this.set('updatingChapterIDs', (ids) => [...ids, id]);
    try {
      // iOS can relocate the app sandbox during an update. Resolve our owned
      // PDF from today's Documents directory instead of relying on its old URL.
      const extraction = await this.services.extract(this.services.resolvePDF(id, content.pdfUri));
      if (!this.booksRef.current.some((book) => book.id === id)) return;
      const { chapters } = detectBookStructure(content.paragraphs, {
        sourcePages: extraction.pages,
        pageLineFonts: extraction.pageLineFonts,
        outlines: extraction.outlines,
        paragraphPages: content.paragraphPages,
      });
      await this.mutateBook(id, async () => {
        const cached = this.contentCache.current.get(id);
        if (this.deleted.has(id) || !cached || cached.content.layoutRevision !== content.layoutRevision
          || this.state.improvingBookID === id) return;
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

  importPDFSource = async (source: PDFSource, openAfterImport = false): Promise<BookSummary | null> => {
      if (this.state.isImporting) return null;

      let destination: File | undefined;
      let importedBookID: string | undefined;

      try {
        this.set('isImporting', true);

        const id = this.services.createID();
        importedBookID = id;
        const booksDirectory = new Directory(Paths.document, 'FlowReader', 'Books');
        booksDirectory.create({ idempotent: true, intermediates: true });

        destination = new File(booksDirectory, `${id}.pdf`);
        await new File(source.uri).copy(destination);

        if (this.services.platform !== 'ios') {
          throw new Error('PDF text extraction is currently available on iOS only.');
        }

        const extraction = await this.services.extract(destination.uri);
        const originalFileName = source.name?.trim() || fileNameFromURI(source.uri);
        const parsed = await this.services.parse(extraction, originalFileName, this.services.tokenize);
        if (!parsed.paragraphs.length) {
          throw new Error('This PDF has no readable text. Try running OCR on it first.');
        }

        const content = contentFromParsed(parsed, destination.uri, this.services.createID());
        const book: StoredBook = {
          ...content,
          id,
          title: parsed.metadata.title.value,
          originalFileName,
          importedAt: this.services.now(),
          lastReadAt: openAfterImport ? this.services.now() : undefined,
          currentParagraph: parsed.readingStart,
          paragraphCount: parsed.paragraphs.length,
        };
        const offsets = buildReadingOffsets(content);
        const summary = await this.services.storage.storeBook({ ...book, ...summaryAtPosition(book, content, offsets) });
        this.contentCache.current.set(id, { content, offsets });
        this.saveLibrary([summary, ...this.booksRef.current]);

        if (openAfterImport) {
          this.showBook({ summary, content, offsets });
        }

        return summary;
      } catch (error) {
        if (importedBookID) await this.services.storage.deleteBookData(importedBookID, destination?.uri);
        this.services.notify('Couldn’t import PDF', friendlyErrorMessage(error));
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

  improveParsing = async () => {
    const current = this.activeBookRef.current;
    if (!current || this.state.improvingBookID) return;
    const id = current.summary.id;
    const session = this.readerSession;
    const revision = current.content.layoutRevision;
    this.set('improvingBookID', id);
    const stillCurrent = () => !this.deleted.has(id) && this.readerSession === session
      && this.activeBookRef.current?.content.layoutRevision === revision;
    try {
      const extraction = await this.services.extract(this.services.resolvePDF(id, current.content.pdfUri));
      if (!stillCurrent()) return;
      const parsed = await this.services.parse(extraction, current.summary.originalFileName, this.services.tokenize);
      if (!stillCurrent()) return;
      if (!parsed.paragraphs.length) throw new Error('The new parser could not find readable prose in this PDF.');
      const content = contentFromParsed(parsed, current.content.pdfUri, this.services.createID());
      const offsets = buildReadingOffsets(content);
      const remap = (summary: BookSummary) => {
        const index = summary.currentParagraph;
        const anchor = summary.currentAnchor ?? current.content.readingUnits?.[index]?.anchor
          ?? sourceAnchorForLegacy(current.content.paragraphs[index] ?? '', current.content.paragraphPages?.[index] ?? 0);
        return remapReadingPosition(anchor, parsed.readingUnits);
      };
      await this.mutateBook(id, async () => {
        if (!stillCurrent()) return;
        const latest = this.booksRef.current.find(book => book.id === id)!;
        if (remap(latest).confidence < 0.9) {
          this.services.notify('Kept your current layout', 'The improved parser could not match your exact reading position with at least 90% confidence, so nothing was changed.');
          return;
        }
        await this.services.storage.storeBookContent(id, content);
        if (this.deleted.has(id)) return; // The queued removal runs after this write.
        const newest = this.booksRef.current.find(book => book.id === id);
        if (!newest) return;
        // Movement can continue while storage writes. Map that latest old-layout
        // position too; an uncertain match restores the previous saved layout.
        const position = remap(newest);
        if (position.confidence < 0.9) {
          await this.services.storage.storeBookContent(id, current.content);
          return;
        }
        const summary = summaryAtPosition({ ...newest, title: parsed.metadata.title.value,
          parserVersion: CONTENT_PARSER_VERSION }, content, offsets, position.index);
        this.contentCache.current.set(id, { content, offsets });
        this.saveLibrary(this.booksRef.current.map(book => book.id === id ? summary : book));
        const active = this.activeBookRef.current;
        if (active?.summary.id === id && active.content.layoutRevision === revision) {
          this.showBook({ summary, content, offsets });
          this.services.notify('Parsing improved', 'The book was reprocessed and your reading position was preserved.');
        }
      });
    } catch (error) {
      if (stillCurrent()) this.services.notify('Couldn’t improve parsing', friendlyErrorMessage(error));
    } finally {
      this.set('improvingBookID', null);
    }
  };

  closeReader = (paragraph: number, session = this.readerSession) => {
      if (session !== this.readerSession) return;
      this.openingRequest.current += 1;
      const current = this.activeBookRef.current;
      if (current) this.updateProgress(current.summary.id, paragraph);
      this.showBook(null);
    };

}
