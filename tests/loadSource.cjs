const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadSource(name, mocks = {}, cache = new Map()) {
  const filename = path.resolve(__dirname, '..', name);
  const relative = path.relative(path.resolve(__dirname, '..'), filename);
  if (relative in mocks) return mocks[relative];
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const sourceRequire = (specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier.startsWith('.')) return loadSource(path.resolve(path.dirname(filename), specifier + (fs.existsSync(path.resolve(path.dirname(filename), specifier + '.ts')) ? '.ts' : '.tsx')), mocks, cache);
    return require(specifier);
  };
  const globals = mocks.$globals ?? {};
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(sourceRequire, module, module.exports, ...Object.values(globals));
  return module.exports;
}
module.exports = { loadSource };
