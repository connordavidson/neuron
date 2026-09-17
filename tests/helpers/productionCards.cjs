// Adapter for existing card assertions, now exercised through the production importer.
const {loadSource} = require('../loadSource.cjs');
const {parseEbook} = loadSource('src/lib/contentParser.ts');
async function paragraphizePagesWithMetadata(pages, chapters = [], tokenize) {
  const result = await parseEbook({ pages, outlines: chapters.map(({title,pageIndex}) => ({title,pageIndex,level:0})) }, 'fixture.pdf', tokenize);
  return result.readingUnits.map(unit => ({text:unit.text,pageIndex:unit.anchor.pageIndex,heading:unit.heading}));
}
module.exports = {paragraphizePagesWithMetadata,paragraphizeWithTokenizer:paragraphizePagesWithMetadata};
