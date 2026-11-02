const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const assets = {
  'marked/lib/marked.umd.js': 'marked.js',
  'dompurify/dist/purify.min.js': 'purify.js',
  'turndown/lib/turndown.browser.umd.js': 'turndown.js',
  'turndown-plugin-gfm/dist/turndown-plugin-gfm.js': 'turndown-plugin-gfm.js'
};
fs.mkdirSync(path.join(root, 'dist/vendor'), {recursive:true});
for (const [source, target] of Object.entries(assets)) fs.copyFileSync(path.join(root, 'node_modules', source), path.join(root, 'dist/vendor', target));
for (const library of ['marked','dompurify','turndown','turndown-plugin-gfm']) fs.copyFileSync(path.join(root, 'node_modules', library, 'LICENSE'), path.join(root, 'dist/vendor', library + '.LICENSE'));
console.log('Browser dependencies prepared. dist/index.html is ready.');
