import { File, FileMode } from 'expo-file-system';
import type { BookFormat } from '../types';
import { EpubArchive, type ByteSource } from './epub/archive';
import { parseEpub } from './epub/parser';
import type { SentenceTokenizer } from './contentParser';

function openSource(uri: string) {
  const handle = new File(uri).open(FileMode.ReadOnly);
  const source: ByteSource = { size: handle.size ?? 0, read: (offset, length) => { handle.offset = offset; return handle.readBytes(length); } };
  return { source, close: () => handle.close() };
}

export async function detectBookFormat(uri: string): Promise<BookFormat> {
  const file = openSource(uri);
  try {
    const prefix = file.source.read(0, Math.min(1024, file.source.size));
    const header = Array.from(prefix, byte => String.fromCharCode(byte)).join('');
    if (prefix[0] === 0x50 && prefix[1] === 0x4b) {
      const archive = new EpubArchive(file.source);
      if (archive.has('mimetype') && archive.has('META-INF/container.xml') && await archive.readText('mimetype') === 'application/epub+zip') return 'epub';
    } else if (header.includes('%PDF-')) return 'pdf';
    throw new Error('This file is not a supported book. Choose a PDF or EPUB file.');
  } finally { file.close(); }
}

export async function parseEpubFile(uri: string, filename: string, tokenize?: SentenceTokenizer) {
  const file = openSource(uri);
  try { return await parseEpub(file.source, filename, tokenize); }
  finally { file.close(); }
}
