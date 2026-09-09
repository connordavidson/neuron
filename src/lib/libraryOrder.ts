import type { BookSummary } from '../types';

export function sortLibrary(books: BookSummary[]): BookSummary[] {
  return [...books].sort((a, b) => {
    // Previously opened books precede unread imports. Imports break ties and
    // keep books with no reading history in a predictable order.
    if (Boolean(a.lastReadAt) !== Boolean(b.lastReadAt)) return a.lastReadAt ? -1 : 1;
    return (b.lastReadAt ?? b.importedAt).localeCompare(a.lastReadAt ?? a.importedAt)
      || b.importedAt.localeCompare(a.importedAt) || a.id.localeCompare(b.id);
  });
}
