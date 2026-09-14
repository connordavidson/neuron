import { matchScannedPageAsync, type PageScanMatch } from './pageScanMatcher';

export type ScanNotice = { title: string; message: string; openSettings?: boolean };
export type PageScanState = {
  phase: 'closed' | 'ready' | 'working' | 'error';
  busy: boolean;
  notice?: ScanNotice;
  undoPosition?: number;
};

const notices: Record<Exclude<PageScanMatch['status'], 'matched'>, ScanNotice> = {
  'too-short': {
    title: 'Include more text',
    message: 'Scan a page with several lines of body text. Include the top of the page and use good light.',
  },
  'not-found': {
    title: 'Couldn’t find this page',
    message: 'Check that the correct ebook is open, then try a sharper scan. Editions with different wording may not match.',
  },
  ambiguous: {
    title: 'This text appears in more than one place',
    message: 'Scan the full page with more surrounding text so we can find your place with confidence.',
  },
};

// Native bridge errors may include framework diagnostics instead of their
// intended description. Keep recovery copy stable and free of internal details.
const nativeErrorMessages: Record<string, string> = {
  ERR_SCAN_PERMISSION: 'Allow camera access in Settings to scan a book page.',
  ERR_SCAN_UNSUPPORTED: 'Page scanning requires a supported physical iPhone or iPad.',
  ERR_SCAN_REBUILD: 'Rebuild the iOS app to enable page scanning.',
  ERR_SCAN_BUSY: 'A page scan is already finishing. Please try again in a moment.',
  ERR_SCAN_PRESENTATION: 'Close this sheet, open your ebook, and try scanning again.',
  ERR_SCAN_PAGE_COUNT: 'Scan just one book page, then tap Save.',
  ERR_SCAN_CAMERA: 'The camera could not scan this page. Please try again.',
  ERR_SCAN_IMAGE: 'This scan could not be read. Please try again.',
  ERR_SCAN_OCR: 'The text could not be read. Try a sharper scan in good light.',
};

type Options = {
  paragraphs: readonly string[];
  scan: () => Promise<string | null>;
  currentPosition: () => number;
  jump: (position: number) => void;
  onChange: (state: PageScanState) => void;
  match?: typeof matchScannedPageAsync;
};

// Own the request identity separately from React renders so duplicate taps,
// cancellation, and a reader unmount cannot commit an obsolete scan result.
export class PageScanSession {
  state: PageScanState = { phase: 'closed', busy: false };
  private request = 0;
  private disposed = false;

  constructor(private readonly options: Options) {}

  private publish(state: PageScanState): void {
    this.state = state;
    if (!this.disposed) this.options.onChange(state);
  }

  open(): void {
    if (!this.disposed && !this.state.busy) this.publish({ phase: 'ready', busy: false });
  }

  cancel(): void {
    this.request += 1;
    this.publish({ phase: 'closed', busy: this.state.busy });
  }

  dispose(): void {
    this.disposed = true;
    this.request += 1;
  }

  dismissUndo(): void {
    this.publish({ ...this.state, undoPosition: undefined });
  }

  undo(): void {
    if (this.disposed || this.state.undoPosition == null) return;
    this.options.jump(this.state.undoPosition);
    this.dismissUndo();
  }

  async start(): Promise<void> {
    if (this.disposed || this.state.busy) return;
    const request = ++this.request;
    const previous = this.options.currentPosition();
    const isCancelled = () => this.disposed || request !== this.request;
    this.publish({ phase: 'working', busy: true });
    try {
      const text = await this.options.scan();
      if (isCancelled()) return;
      if (text == null) {
        this.publish({ phase: 'ready', busy: true });
        return;
      }
      const result = await (this.options.match ?? matchScannedPageAsync)(this.options.paragraphs, text, isCancelled);
      if (isCancelled() || result == null) return;
      if (result.status === 'matched') {
        this.options.jump(result.paragraphIndex);
        this.publish({ phase: 'closed', busy: true, undoPosition: previous });
      } else {
        this.publish({ phase: 'error', busy: true, notice: notices[result.status] });
      }
    } catch (error) {
      if (isCancelled()) return;
      const code = (error as { code?: string } | null)?.code;
      this.publish({ phase: 'error', busy: true, notice: {
        title: code === 'ERR_SCAN_PERMISSION' ? 'Camera access is off' : 'Couldn’t scan this page',
        message: nativeErrorMessages[code ?? ''] ?? 'The scan could not be completed. Please try again.',
        openSettings: code === 'ERR_SCAN_PERMISSION',
      } });
    } finally {
      // Cancel keeps the button locked until native work settles, preventing
      // a second camera presentation while the first request is finishing.
      if (!this.disposed) this.publish({ ...this.state, busy: false });
    }
  }
}
