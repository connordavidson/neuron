export type PageScanMatch =
  | { status: 'matched'; paragraphIndex: number; matchedWords: number }
  | { status: 'too-short' | 'not-found' | 'ambiguous' };

function words(text: string): string[] {
  return text.normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/\u00ad/gu, '').replace(/(\p{L})[-‐]\s*\n\s*(?=\p{L})/gu, '$1')
    .toLowerCase().replace(/[’']/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];
}

type Alignment = { score: number; matches: number; start: number; end: number; anchor: number };

// Local sequence alignment tolerates OCR substitutions, missing words, and
// running headers without relying on the printed edition's pagination.
function* align(query: string[], text: string[], offset: number): Generator<void, Alignment[]> {
  const width = text.length + 1;
  const scores = new Int32Array((query.length + 1) * width);
  let best = 0;
  for (let i = 1; i <= query.length; i += 1) {
    if (i % 16 === 0) yield;
    for (let j = 1; j <= text.length; j += 1) {
      const cell = i * width + j;
      scores[cell] = Math.max(0,
        scores[cell - width - 1]! + (query[i - 1] === text[j - 1] ? 3 : -2),
        scores[cell - width]! - 2, scores[cell - 1]! - 2);
      if (scores[cell]! > scores[best]!) best = cell;
    }
  }
  function trace(endpoint: number): Alignment {
    let i = Math.floor(endpoint / width);
    let j = endpoint % width;
    const end = offset + j;
    let matches = 0;
    const matchingTokens: Array<{ query: number; text: number }> = [];
    while (i > 0 && j > 0 && scores[i * width + j]! > 0) {
      const cell = i * width + j;
      const equal = query[i - 1] === text[j - 1];
      if (scores[cell] === scores[cell - width - 1]! + (equal ? 3 : -2)) {
        if (equal) {
          matches += 1;
          matchingTokens.push({ query: i - 1, text: j - 1 });
        }
        i -= 1;
        j -= 1;
      } else if (scores[cell] === scores[cell - width]! - 2) i -= 1;
      else j -= 1;
    }
    matchingTokens.reverse();
    // A stray header word may align with the preceding card. Anchor the jump
    // to the first corroborating phrase, rather than that isolated word.
    const phraseStart = matchingTokens.find((token, index) =>
      matchingTokens[index + 1]?.query === token.query + 1 && matchingTokens[index + 1]?.text === token.text + 1
      && matchingTokens[index + 2]?.query === token.query + 2 && matchingTokens[index + 2]?.text === token.text + 2);
    return { score: scores[endpoint]!, matches, start: offset + j, end,
      anchor: offset + (phraseStart?.text ?? j) };
  }
  const primary = trace(best);
  const results = [primary];
  // A candidate window may contain two copies of a quotation. Inspect the
  // strongest endpoint at every text position, not just the window's winner.
  for (let j = 1; j <= text.length; j += 1) {
    if (j % 32 === 0) yield;
    let endpoint = j;
    for (let i = 1; i <= query.length; i += 1) {
      const cell = i * width + j;
      if (scores[cell]! > scores[endpoint]!) endpoint = cell;
    }
    if (scores[endpoint]! < primary.score * 0.85) continue;
    const result = trace(endpoint);
    if (!samePassage(primary, result)) results.push(result);
  }
  return results;
}

function samePassage(a: Alignment, b: Alignment): boolean {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  return overlap >= Math.min(a.end - a.start, b.end - b.start) * 0.5;
}

function* matchSteps(paragraphs: readonly string[], scannedText: string): Generator<void, PageScanMatch> {
  // Bound alignment work for unusually dense pages; use the top of the page.
  const query = words(scannedText).slice(0, 400);
  if (query.length < 16 || new Set(query).size < 10) return { status: 'too-short' };
  const text: string[] = [];
  const paragraphAt: number[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (index % 64 === 0) yield;
    for (const word of words(paragraphs[index]!)) {
      text.push(word);
      paragraphAt.push(index);
    }
  }

  // Index only phrases present in the scan, keeping memory linear in book size.
  const phrases = new Map<string, number[]>();
  const phrase = (tokens: string[], i: number) => tokens.slice(i, i + 3).join(' ');
  for (let i = 0; i < query.length - 2; i += 1) phrases.set(phrase(query, i), []);
  for (let i = 0; i < text.length - 2; i += 1) {
    if (i % 2048 === 0) yield;
    const positions = phrases.get(phrase(text, i));
    if (positions && positions.length <= 80) positions.push(i);
  }
  const votes = new Map<number, number>();
  for (let i = 0; i < query.length - 2; i += 1) {
    const positions = phrases.get(phrase(query, i))!;
    if (positions.length > 80) continue;
    for (const position of positions) {
      const bucket = Math.floor((position - i) / 32);
      votes.set(bucket, (votes.get(bucket) ?? 0) + 1);
    }
  }
  // Common prose can produce many three-word hits in a long book. They are
  // leads, not matches: rank them, then let the full sequence comparison
  // decide whether another passage is genuinely as good.
  const candidates = [...votes]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 96);
  const results: Alignment[] = [];
  for (const [bucket] of candidates) {
    const start = Math.max(0, bucket * 32 - 48);
    const end = Math.min(text.length, bucket * 32 + query.length + 80);
    results.push(...(yield* align(query, text.slice(start, end), start)));
  }
  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  if (!best || best.matches < 16 || best.matches / query.length < 0.65
    || best.score / (query.length * 3) < 0.5) return { status: 'not-found' };
  // Consolidate windows for the same passage before comparing distinct places.
  // Keep weak runner-ups too: near-equal alternatives make a jump unsafe even
  // when the runner-up narrowly misses the absolute acceptance threshold.
  const other = results.find(result => !samePassage(best, result));
  if (other && other.score >= best.score * 0.85) return { status: 'ambiguous' };
  return { status: 'matched', paragraphIndex: paragraphAt[best.anchor]!, matchedWords: best.matches };
}

// Synchronous entry point for deterministic fixtures and command-line audits.
export function matchScannedPage(paragraphs: readonly string[], scannedText: string): PageScanMatch {
  const steps = matchSteps(paragraphs, scannedText);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

// The reader yields at most every ~8 ms of batched work. Cancellation stops
// further processing and releases the local book index when the generator exits.
export async function matchScannedPageAsync(
  paragraphs: readonly string[], scannedText: string, isCancelled: () => boolean = () => false,
): Promise<PageScanMatch | null> {
  const steps = matchSteps(paragraphs, scannedText);
  let lastYield = 0;
  try {
    while (!isCancelled()) {
      if (Date.now() - lastYield >= 8) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        lastYield = Date.now();
        if (isCancelled()) return null;
      }
      const step = steps.next();
      if (step.done) return step.value;
    }
    return null;
  } finally {
    steps.return({ status: 'not-found' });
  }
}
