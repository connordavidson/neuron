// Compatibility only: fresh imports use parseEbook and readingUnits.
export const PARAGRAPH_PARSER_VERSION = 5;

// Repair the old boundary bug in already-imported books without changing page
// counts, chapter indices, or bookmarks. An opening quote attached to a word is
// deliberately not moved.
export function repairQuotationBoundaries(paragraphs: string[]): string[] {
  const repaired = [...paragraphs];
  for (let i = 1; i < repaired.length; i += 1) {
    const previous = repaired[i - 1] ?? '';
    const current = repaired[i] ?? '';
    const closing = current.match(/^(?:[”’»）)\]}]+|["']+(?=\s|$))/u)?.[0];
    if (!closing || !/[.!?…]["'”’»）)\]}]*$/u.test(previous)) continue;
    const remaining = current.slice(closing.length).trimStart();
    if (!remaining) continue;
    repaired[i - 1] = previous + closing;
    repaired[i] = remaining;
  }
  return repaired;
}
