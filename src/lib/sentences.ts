export type SentenceSpan = { text: string; start: number };
const CLOSE = /["'”’»）)\]}]/u;
const TERMINAL = /[.!?…。！？]/u;
const WORD = /[\p{L}\p{N}]/u;

// Native offsets and JavaScript indices both use UTF-16. Treat the native
// tokenizer's boundaries as proposals, with extra guards for PDF punctuation.
export function sentenceSpans(text: string, proposedEnds?: number[]): SentenceSpan[] {
  const allowed = proposedEnds && new Set(proposedEnds.map((offset) => {
    let end = Math.min(text.length, Math.max(0, offset));
    while (end && /\s/u.test(text[end - 1]!)) end--;
    while (end < text.length && CLOSE.test(text[end]!)) end++;
    return end;
  }));
  const result: SentenceSpan[] = [];
  let start = 0;
  const emit = (end: number) => {
    while (start < end && /\s/u.test(text[start]!)) start++;
    const value = text.slice(start, end).trimEnd();
    if (value) {
      if (!WORD.test(value) && result.length) result[result.length - 1]!.text += ' ' + value;
      else result.push({ text: value, start });
    }
    start = end;
  };
  for (let index = 0; index < text.length; index++) {
    if (!TERMINAL.test(text[index]!)) continue;
    const punctuationStart = index;
    let end = index + 1;
    // Preserve the original dots/spaces but consume the entire ellipsis at once.
    while (end < text.length) {
      if (TERMINAL.test(text[end]!)) { end++; continue; }
      if (text[end - 1] === '.') {
        let next = end;
        while (next < text.length && /\s/u.test(text[next]!)) next++;
        if (text[next] === '.') { end = next + 1; continue; }
      }
      break;
    }
    const punctuation = text.slice(punctuationStart, end);
    const punctuationEnd = end;
    while (end < text.length && CLOSE.test(text[end]!)) end++;
    index = end - 1;
    if (text[end] && !/\s/u.test(text[end]!) && !/[。！？]/u.test(punctuation)) continue;
    if (!WORD.test(text.slice(start, punctuationStart))) continue;
    const next = text.slice(end).trimStart();
    const ellipsis = /…/u.test(punctuation) || (punctuation.match(/\./g)?.length ?? 0) >= 2;
    // Conservatively keep pauses/omissions inside their sentence. Closed dialogue
    // followed by a new uppercase sentence is a clear exception.
    if (ellipsis && next && !(end > punctuationEnd && /^[“"‘'([{]*\p{Lu}/u.test(next))) continue;
    if (/^\p{Ll}/u.test(next)) continue; // e.g. “Really?” she asked.
    if (punctuation === '.' && next) {
      const prefix = text.slice(start, punctuationStart + 1);
      if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|e\.g|i\.e)\.$/iu.test(prefix)) continue;
      if (/\b\p{Lu}\.$/u.test(prefix) && /^\p{Lu}/u.test(next)) continue;
    }
    if (allowed && !allowed.has(end) && end !== text.length) continue;
    emit(end);
  }
  emit(text.length);
  return result;
}

export function splitSentences(text: string): string[] {
  return sentenceSpans(text).map((span) => span.text);
}
