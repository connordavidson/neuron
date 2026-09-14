function page(index, lines, label = String(index + 1)) {
  let sourceStart = 0;
  const spans = lines.map((line, lineIndex) => {
    const text = typeof line === 'string' ? line : line.text;
    const fontSize = typeof line === 'string' ? 11 : line.fontSize ?? 11;
    const y = typeof line === 'string' ? (/^\d+$/.test(line) ? 750 : 80 + lineIndex * 18) : line.y ?? 80 + lineIndex * 18;
    const x = typeof line === 'string' ? 68 : line.x ?? 68;
    const sourceEnd = sourceStart + text.length;
    const span = {
      text,
      sourceStart,
      sourceEnd,
      lineIndex,
      bounds: { x, y, width: Math.min(480, text.length * fontSize * 0.48), height: fontSize * 1.15 },
      fontName: 'TimesNewRomanPSMT',
      fontSize,
      bold: typeof line === 'string' ? false : line.bold ?? false,
      italic: false,
    };
    sourceStart = sourceEnd + 1;
    return span;
  });
  return {
    index,
    label,
    width: 612,
    height: 792,
    rotation: 0,
    text: lines.map(line => typeof line === 'string' ? line : line.text).join('\n'),
    spans,
    links: [],
  };
}

function fixtureExtraction() {
  const pages = [
    page(0, [{ text: 'A RELIABLE BOOK', fontSize: 28, bold: true, x: 180 }, { text: 'By Ada Reader', fontSize: 14, x: 240 }]),
    page(1, ['Copyright © 2026 Ada Reader', 'ISBN 978-1-23456-789-0', 'Published by Example Press']),
    page(2, [{ text: 'CONTENTS', fontSize: 20, bold: true, x: 240 }, 'Chapter One .... 1', 'Chapter Two .... 3', 'Appendix .... 5']),
    page(3, ['A RELIABLE BOOK', { text: 'CHAPTER ONE: BEGINNINGS', fontSize: 20, bold: true, x: 150 }, 'The first sentence begins here. The second sentence ends here.', '3']),
    page(4, ['A RELIABLE BOOK', 'This sentence crosses a PDF', 'page boundary without stopping', 'until this point. A fourth sentence follows.', { text: '1 A small contextual footnote.', fontSize: 7, y: 710 }, '4']),
    page(5, ['A RELIABLE BOOK', { text: 'CHAPTER TWO: CONTINUING', fontSize: 20, bold: true, x: 145 }, 'A new chapter starts cleanly. Its second sentence stays here.', '5']),
    page(6, ['A RELIABLE BOOK', { text: 'APPENDIX A', fontSize: 20, bold: true, x: 230 }, 'Appendix prose remains available. This is its second sentence.', '6']),
    page(7, ['A RELIABLE BOOK', { text: 'REFERENCES', fontSize: 20, bold: true, x: 230 }, 'Reader, A. 2026. A cited work.', '7']),
  ];
  return {
    title: 'A Reliable Book',
    pages: pages.map(({ text }) => text),
    structuredPages: pages,
    metadata: { title: 'A Reliable Book', author: 'Ada Reader' },
    outlines: [
      { title: 'Chapter One: Beginnings', pageIndex: 3, level: 0 },
      { title: 'Chapter Two: Continuing', pageIndex: 5, level: 0 },
      { title: 'Appendix A', pageIndex: 6, level: 0 },
      { title: 'Decorative quotation', pageIndex: 4, level: 1 },
    ],
  };
}

module.exports={page,fixtureExtraction};
