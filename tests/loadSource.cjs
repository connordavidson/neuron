const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadSource(name, mocks = {}, cache = new Map()) {
  const filename = path.resolve(__dirname, '..', name);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const sourceRequire = (specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(filename), specifier);
      return loadSource(fs.existsSync(resolved + '.ts') ? resolved + '.ts' : resolved + '.tsx', mocks, cache);
    }
    return require(specifier);
  };
  new Function('require', 'module', 'exports', code)(sourceRequire, module, module.exports);
  return module.exports;
}
module.exports = { loadSource };
