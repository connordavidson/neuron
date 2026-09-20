import { File, Paths } from 'expo-file-system';
import type { BookFormat } from '../types';

export function resolveBookPDF(id: string, fallback: string): string {
  return resolveBookFile(id, 'pdf', fallback);
}

export function resolveBookFile(id: string, format: BookFormat, fallback: string): string {
  const local = new File(Paths.document, 'FlowReader', 'Books', `${id}.${format}`);
  return local.exists ? local.uri : fallback;
}
