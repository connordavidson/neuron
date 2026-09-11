const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const moduleCache = new Map();
function loadTypeScript(filename) {
  filename = path.resolve(filename);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const module = { exports: {} };
  moduleCache.set(filename, module);
  const source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = specifier => specifier.startsWith('.')
    ? loadTypeScript(path.resolve(path.dirname(filename), specifier + '.ts'))
    : require(specifier);
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports;
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node tools/run_parser.cjs INPUT.json OUTPUT.json');
  const extraction = JSON.parse(fs.readFileSync(input, 'utf8'));
  const parser = loadTypeScript(path.resolve(__dirname, '../src/lib/contentParser.ts'));
  const sentences = loadTypeScript(path.resolve(__dirname, '../src/lib/sentences.ts'));
  const parsed = await parser.parseEbook(extraction, extraction.sourceFile || path.basename(input, '.json') + '.pdf');
  parsed.sentenceEnds = parsed.readingUnits.flatMap(unit =>
    unit.sentences?.map(sentence => parser.hashContext(sentence.text))
      ?? sentences.sentenceSpans(unit.text).map(span => parser.hashContext(span.text)));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(parsed, null, 2) + '\n');
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
