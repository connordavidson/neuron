import type { SemanticSectionKind } from '../../types';
import { normalizeKey } from './utils';

export const NAVIGABLE_KINDS = new Set<SemanticSectionKind>([
  'cover', 'titlePage', 'copyright', 'dedication', 'contents', 'unknownFront',
  'foreword', 'preface', 'acknowledgments', 'introduction', 'part', 'chapter',
  'section', 'conclusion', 'epilogue', 'appendix', 'glossary', 'notes',
  'bibliography', 'index', 'aboutAuthor', 'colophon',
]);

export const PRIMARY_KINDS = new Set<SemanticSectionKind>([
  'cover', 'titlePage', 'copyright', 'dedication', 'contents', 'unknownFront',
  'notes', 'bibliography', 'index', 'colophon', 'unknownBack',
  'foreword', 'preface', 'acknowledgments', 'introduction', 'part', 'chapter',
  'section', 'conclusion', 'epilogue', 'appendix', 'glossary', 'aboutAuthor', 'body',
]);

export const BODY_START_KINDS = new Set<SemanticSectionKind>([
  'foreword', 'preface', 'introduction', 'part', 'chapter', 'section', 'body',
]);

export const BACK_KINDS = new Set<SemanticSectionKind>([
  'conclusion', 'epilogue', 'appendix', 'glossary', 'notes', 'bibliography',
  'index', 'aboutAuthor', 'colophon', 'unknownBack',
]);

export const FRONT_KINDS = new Set<SemanticSectionKind>([
  'cover', 'titlePage', 'copyright', 'dedication', 'contents', 'unknownFront',
]);

// Small print is the main content of these sections, not a body footnote.
export const COMPLETE_TEXT_KINDS = new Set<SemanticSectionKind>([
  ...FRONT_KINDS, 'notes', 'bibliography', 'index', 'glossary', 'colophon', 'unknownBack',
]);

export const EXPLICIT_NUMBER = '(?:\\d{1,4}|[IVXLCDM]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';

export const CHAPTER_PATTERN = new RegExp(`^(?:chapter|ch\\.?|habit)\\s+${EXPLICIT_NUMBER}(?:\\s*[:.\\-–—]\\s*.+)?$`, 'iu');

export const PART_PATTERN = new RegExp(`^(?:part|book)\\s+${EXPLICIT_NUMBER}(?:\\s*[:.\\-–—]\\s*.+)?$`, 'iu');

export const NUMBERED_SECTION_PATTERN = new RegExp(`^${EXPLICIT_NUMBER}(?:\\.\\d+)*[.:]?\\s+\\p{Lu}`, 'u');

export const TERMINAL_PROSE = /[.!?…]["'”’»）)\]}]*$/u;

export function classifySectionTitle(value: string): { kind: SemanticSectionKind; level: number } | undefined {
  const text = normalizeKey(value);
  if (/^(?:also by|other (?:books|works) by|books by)\b/.test(text)) return { kind: 'unknownFront', level: 0 };
  if (/^(?:cover)$/.test(text)) return { kind: 'cover', level: 0 };
  if (/^(?:title page)$/.test(text)) return { kind: 'titlePage', level: 0 };
  if (/^(?:copyright|imprint|license|publication details?)$/.test(text)) return { kind: 'copyright', level: 0 };
  if (/^(?:dedication)$/.test(text)) return { kind: 'dedication', level: 0 };
  if (/^(?:(?:table of )?contents)$/.test(text)) return { kind: 'contents', level: 0 };
  if (/^(?:foreword)\b/.test(text)) return { kind: 'foreword', level: 1 };
  if (/^(?:preface)\b/.test(text)) return { kind: 'preface', level: 1 };
  if (/^acknowledg(?:e)?ments?\b/.test(text)) return { kind: 'acknowledgments', level: 1 };
  if (/^(?:introduction|prologue)\b/.test(text)) return { kind: 'introduction', level: 1 };
  if (PART_PATTERN.test(value)) return { kind: 'part', level: 0 };
  if (CHAPTER_PATTERN.test(value)) return { kind: 'chapter', level: 1 };
  if (/^(?:conclusion)\b/.test(text)) return { kind: 'conclusion', level: 1 };
  if (/^(?:epilogue|afterword)\b/.test(text)) return { kind: 'epilogue', level: 1 };
  if (/^(?:appendix|appendices)\b/.test(text)) return { kind: 'appendix', level: 1 };
  if (/^(?:glossary|list of abbreviations|abbreviations in (?:the )?notes)\b/.test(text)) return { kind: 'glossary', level: 1 };
  if (/^(?:notes|endnotes|footnotes)(?: to (?:chapter|part) .+)?$/.test(text)) return { kind: 'notes', level: 1 };
  if (/^(?:(?:selected )?bibliography|references|works cited|further reading)$/.test(text)) return { kind: 'bibliography', level: 1 };
  if (/^(?:(?:subject|author|name) )?index$/.test(text)) return { kind: 'index', level: 1 };
  if (/^(?:about (?:the )?author|contributors?|author biography)\b/.test(text)) return { kind: 'aboutAuthor', level: 1 };
  if (/^(?:colophon|(?:illustration|photo|photograph|image) credits|credits)$/.test(text)) return { kind: 'colophon', level: 1 };
  return undefined;
}

// Progress eligibility is independent of visibility and first-open placement.
export const PROGRESS_EXCLUDED_KINDS = new Set<SemanticSectionKind>([
  'cover', 'titlePage', 'copyright', 'dedication', 'contents', 'unknownFront',
  'notes', 'bibliography', 'index', 'aboutAuthor', 'colophon', 'unknownBack',
]);
