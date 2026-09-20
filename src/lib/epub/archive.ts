import { Unzip, UnzipInflate, strFromU8 } from 'fflate';

export type ByteSource = { size: number; read: (offset: number, length: number) => Uint8Array };
export const EPUB_LIMITS = { compressed: 100 * 1024 * 1024, entries: 10_000, document: 8 * 1024 * 1024, text: 64 * 1024 * 1024 };
type Limits = typeof EPUB_LIMITS;
type Entry = { size: number; compressed: number; crc: number; offset: number; method: number };
const invalid = () => new Error('This EPUB is damaged or has an unsupported ZIP structure.');
const tooLarge = () => new Error('This EPUB is too large to import safely. Try a smaller, text-focused edition.');
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: (offset, length) => bytes.subarray(offset, offset + length) };
}

/** Archive entry names are literal; only URLs pointing into the archive are percent-decoded. */
export function validateArchivePath(path: string): string {
  if (!path || /[\\\u0000-\u001f]/u.test(path) || path.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(path)
    || path.split('/').some(part => part === '..' || part === '.')) throw invalid();
  return path;
}

export function resolveReference(base: string, href: string): { path: string; fragment?: string } | null {
  if (/^[a-z][a-z\d+.-]*:|^\/\//iu.test(href.trim())) return null;
  const [resource, fragment] = href.split('#', 2);
  let decoded: string, id: string | undefined;
  try { decoded = decodeURIComponent((resource ?? '').split('?', 1)[0]!); id = fragment ? decodeURIComponent(fragment) : undefined; }
  catch { throw new Error('This EPUB contains an invalid document link.'); }
  if (!decoded) return { path: base, fragment: id };
  if (decoded.startsWith('/') || /[\\\u0000-\u001f]/u.test(decoded) || /^[a-z][a-z\d+.-]*:/iu.test(decoded)) throw invalid();
  const parts = base.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) throw invalid(); parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return { path: validateArchivePath(parts.join('/')), fragment: id };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crcUpdate(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  return crc;
}

/** Reads only requested resources. Images/fonts are never inflated. */
export class EpubArchive {
  readonly entries = new Map<string, Entry>();
  private cache = new Map<string, string>();
  private extracted = 0;
  constructor(private source: ByteSource, private limits: Limits = EPUB_LIMITS) {
    if (source.size > limits.compressed) throw tooLarge();
    if (source.size < 22) throw invalid();
    const tailStart = Math.max(0, source.size - 65557);
    const tail = source.read(tailStart, source.size - tailStart);
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let eocd = tail.length - 22;
    while (eocd >= 0 && !(view.getUint32(eocd, true) === 0x06054b50 && eocd + 22 + view.getUint16(eocd + 20, true) === tail.length)) eocd--;
    if (eocd < 0 || view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true)) throw invalid();
    const count = view.getUint16(eocd + 10, true), size = view.getUint32(eocd + 12, true), offset = view.getUint32(eocd + 16, true);
    if (count > limits.entries) throw tooLarge();
    if (!count || view.getUint16(eocd + 8, true) !== count || offset + size !== tailStart + eocd) throw invalid();
    let cursor = offset;
    for (let index = 0; index < count; index++) {
      const header = source.read(cursor, 46);
      if (header.length !== 46) throw invalid();
      const data = new DataView(header.buffer, header.byteOffset, header.byteLength);
      if (data.getUint32(0, true) !== 0x02014b50) throw invalid();
      const flags = data.getUint16(8, true), method = data.getUint16(10, true), nameSize = data.getUint16(28, true);
      if (flags & 1) throw new Error('Encrypted EPUB files are not supported. Import a DRM-free edition.');
      if (method !== 0 && method !== 8) throw invalid();
      const name = validateArchivePath(strFromU8(source.read(cursor + 46, nameSize)));
      const entry = { size: data.getUint32(24, true), compressed: data.getUint32(20, true), crc: data.getUint32(16, true), offset: data.getUint32(42, true), method };
      if (this.entries.has(name) || entry.offset + 30 + entry.compressed > offset) throw invalid();
      this.entries.set(name, entry);
      cursor += 46 + nameSize + data.getUint16(30, true) + data.getUint16(32, true);
      if (cursor > offset + size) throw invalid();
    }
    if (cursor !== offset + size) throw invalid();
  }

  has(path: string): boolean { return this.entries.has(path); }

  async readText(path: string): Promise<string> {
    if (this.cache.has(path)) return this.cache.get(path)!;
    const entry = this.entries.get(path);
    if (!entry) throw new Error(`This EPUB is missing a required document (${path}).`);
    if (entry.size > this.limits.document || this.extracted + entry.size > this.limits.text) throw tooLarge();
    const header = this.source.read(entry.offset, 30);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (header.length !== 30 || view.getUint32(0, true) !== 0x04034b50 || view.getUint16(8, true) !== entry.method || view.getUint16(6, true) & 1) throw invalid();
    const prefixSize = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    const name = strFromU8(this.source.read(entry.offset + 30, view.getUint16(26, true)));
    if (name !== path || entry.offset + prefixSize + entry.compressed > this.source.size) throw invalid();
    // Feed an isolated local entry with its central-directory sizes. This also
    // handles ZIP data descriptors without depending on the following entry.
    const prefix = this.source.read(entry.offset, prefixSize).slice();
    const local = new DataView(prefix.buffer);
    local.setUint16(6, local.getUint16(6, true) & ~8, true);
    local.setUint32(14, entry.crc, true);
    local.setUint32(18, entry.compressed, true);
    local.setUint32(22, entry.size, true);
    const chunks: Uint8Array[] = [];
    let length = 0, crc = -1, finished = false;
    const unzip = new Unzip(file => {
      file.ondata = (error, chunk, final) => {
        if (error) throw invalid();
        length += chunk.length;
        if (length > entry.size || length > this.limits.document || this.extracted + length > this.limits.text) throw tooLarge();
        crc = crcUpdate(crc, chunk);
        chunks.push(chunk);
        finished = final;
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    unzip.push(prefix, entry.compressed === 0);
    for (let offset = 0; offset < entry.compressed; offset += 4096) {
      const size = Math.min(4096, entry.compressed - offset);
      unzip.push(this.source.read(entry.offset + prefixSize + offset, size), offset + size === entry.compressed);
      if (offset % 65536 === 0) await pause();
    }
    if (!finished || length !== entry.size || ((crc ^ -1) >>> 0) !== entry.crc) throw invalid();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const text = decodeDocument(bytes);
    this.extracted += length;
    this.cache.set(path, text);
    return text;
  }
}

function decodeDocument(bytes: Uint8Array): string {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
    || (bytes[0] === 0 && bytes[1] === 60) || (bytes[0] === 60 && bytes[1] === 0)) {
    const little = bytes[0] === 0xff || bytes[0] === 60;
    const start = bytes[0] === 0xff || bytes[0] === 0xfe ? 2 : 0;
    if ((bytes.length - start) % 2) throw invalid();
    const parts: string[] = [];
    for (let index = start; index < bytes.length; index += 2) parts.push(String.fromCharCode(little ? bytes[index]! | bytes[index + 1]! << 8 : bytes[index]! << 8 | bytes[index + 1]!));
    return parts.join('');
  }
  const text = strFromU8(bytes).replace(/^\uFEFF/u, '');
  const encoding = text.match(/^<\?xml[^?]*encoding=["']([^"']+)/iu)?.[1];
  if (encoding && !/^utf-?8$/iu.test(encoding)) throw new Error(`This EPUB uses an unsupported text encoding (${encoding}).`);
  return text;
}
