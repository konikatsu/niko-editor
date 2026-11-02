const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const root = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {runScripts: 'outside-only', url: 'https://editor.example/'});
for (const file of [
  'node_modules/marked/lib/marked.umd.js',
  'node_modules/dompurify/dist/purify.js',
  'node_modules/turndown/dist/turndown.js',
  'node_modules/turndown-plugin-gfm/dist/turndown-plugin-gfm.js',
  'dist/editor-core.js'
]) dom.window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
const core = dom.window.NikoCore;
function fragment(html) {
  const element = dom.window.document.createElement('div');
  element.innerHTML = html;
  return element;
}

test('Markdown renders Japanese, headings, links, GFM tables, tasks and escaped code', () => {
  const md = '# 日本語と絵文字 🌱\n\n**太字** と *斜体*、~~取消~~ [リンク](https://example.com)\n\n- [x] 完了\n- [ ] 未完了\n\n| 名前 | 状態 |\n| --- | --- |\n| テスト | 良好 |\n\n```html\n<script>alert("x")</script>\n```';
  const html = fragment(core.fromMarkdown(md));
  assert.equal(html.querySelector('h1').textContent, '日本語と絵文字 🌱');
  assert.equal(html.querySelector('strong').textContent, '太字');
  assert.equal(html.querySelectorAll('table tr').length, 2);
  assert.equal(html.querySelectorAll('input[type=checkbox]').length, 2);
  assert.equal(html.querySelector('input').checked, true);
  assert.equal(html.querySelector('input').disabled, true);
  assert.match(html.querySelector('code').textContent, /<script>/);
  assert.equal(html.querySelectorAll('script').length, 0);
  assert.equal(html.querySelector('a').getAttribute('rel'), 'noopener noreferrer');
});

test('text color, highlight, underline, legacy font color and alignment survive HTML–Markdown–HTML', () => {
  const input = '<h2 style="text-align: center">中央</h2><p>通常 <span style="color:#d62d48;background-color:#fff2a8"><strong>色付き</strong></span> <u>下線</u> <mark>ハイライト</mark> <font color="#2466bb">青</font></p>';
  const md = core.toMarkdown(input);
  assert.match(md, /<span style=/);
  assert.match(md, /<u>下線<\/u>/);
  const html = fragment(core.fromMarkdown(md));
  assert.equal(html.querySelector('h2').style.textAlign, 'center');
  assert.equal(html.querySelector('span').style.color, 'rgb(214, 45, 72)');
  assert.equal(html.querySelector('span').style.backgroundColor, 'rgb(255, 242, 168)');
  assert.equal(html.querySelector('span strong').textContent, '色付き');
  assert.equal(html.querySelector('font').style.color, 'rgb(36, 102, 187)');
  assert.equal(html.querySelector('mark').textContent, 'ハイライト');
});

test('semantic content survives a complete Markdown round trip', () => {
  const initial = '# 見出し\n\n> 引用\n\n1. 一つ目\n2. 二つ目\n   - 子要素\n\n[説明](https://example.com/a?q=1&b=2)\n\n```js\nconst x = a < 2 && b > 3;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
  const md = core.toMarkdown(core.fromMarkdown(initial));
  const html = fragment(core.fromMarkdown(md));
  assert.equal(html.querySelector('h1').textContent, '見出し');
  assert.equal(html.querySelector('blockquote').textContent.trim(), '引用');
  assert.equal(html.querySelectorAll('ol > li').length, 2);
  assert.equal(html.querySelector('ol ul li').textContent, '子要素');
  assert.equal(html.querySelector('a').href, 'https://example.com/a?q=1&b=2');
  assert.equal(html.querySelector('code').textContent.trim(), 'const x = a < 2 && b > 3;');
  assert.equal(html.querySelector('code').className, 'language-js');
  assert.equal(html.querySelectorAll('table td').length, 2);
});

test('sanitizer removes executable markup, unsafe URLs and styles while retaining safe formatting', () => {
  const input = '<script>window.pwned=1</script><style>body{display:none}</style><iframe src="https://evil.example"></iframe>' +
    '<svg onload="alert(1)"><a href="javascript:alert(1)">x</a></svg><object data="x"></object>' +
    '<img src="javascript:alert(1)" onerror="alert(1)" srcset="https://evil.example/a 2x">' +
    '<a href="java&#10;script:alert(1)" onclick="alert(1)">危険</a>' +
    '<p id="clobber" name="location" style="position:fixed;inset:0;background-image:url(https://evil.example/a);color:rgb(1,2,3);text-align:right;font-weight:bold">安全</p>' +
    '<input type="text" autofocus value="a"><input type="checkbox" checked>';
  const html = fragment(core.sanitize(input));
  assert.equal(html.querySelectorAll('script,style,iframe,svg,object,input[type=text]').length, 0);
  assert.equal(html.querySelector('img').hasAttribute('src'), false);
  assert.equal(html.querySelector('img').hasAttribute('srcset'), false);
  assert.equal(html.querySelector('img').hasAttribute('onerror'), false);
  assert.equal(html.querySelector('a').hasAttribute('href'), false);
  assert.equal(html.querySelector('a').hasAttribute('onclick'), false);
  const paragraph = html.querySelector('p');
  assert.equal(paragraph.style.color, 'rgb(1, 2, 3)');
  assert.equal(paragraph.style.textAlign, 'right');
  assert.equal(paragraph.style.fontWeight, 'bold');
  assert.equal(paragraph.style.position, '');
  assert.equal(paragraph.style.backgroundImage, '');
  assert.equal(paragraph.hasAttribute('id'), false);
  assert.equal(html.querySelector('input').disabled, true);
});

test('unsafe data images are removed while embedded bitmap and normal image markup survive', () => {
  const html = fragment(core.sanitize('<img src="data:image/svg+xml;base64,PHN2Zy8+"><img src="data:image/png;base64,aGVsbG8="><img src="https://example.com/image.png" alt="画像">'));
  const images = html.querySelectorAll('img');
  assert.equal(images[0].hasAttribute('src'), false);
  assert.equal(images[1].getAttribute('src'), 'data:image/png;base64,aGVsbG8=');
  assert.equal(images[2].getAttribute('src'), 'https://example.com/image.png');
  assert.match(core.toMarkdown(html.innerHTML), /!\[画像\]\(https:\/\/example.com\/image.png\)/);
});

test('preview is a self-contained CSP-protected document with inert links and no imported active content', () => {
  const output = core.previewDocument('<h1>資料</h1><a href="https://example.com">外部</a><a href="#test">内部</a><script>alert(1)</script><img src="https://example.com/image.png">');
  const preview = new JSDOM(output).window.document;
  const csp = preview.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /img-src data: blob:/);
  assert.match(csp, /form-action 'none'/);
  assert.equal(preview.querySelectorAll('script,link,iframe,a[href]').length, 0);
  assert.equal(preview.documentElement.lang, 'ja');
  assert.equal(preview.querySelector('main h1').textContent, '資料');
});

test('same-format Markdown remains byte-for-byte intact and empty values stay empty', () => {
  const original = '\ufeff# hello\r\n\r\n  - item\r\n\r\n';
  assert.equal(core.convert(original, 'md', 'md'), original);
  assert.equal(core.convert(original, 'markdown', 'markdown'), original);
  assert.equal(core.toHTML('', 'md'), '');
  assert.equal(core.toMarkdown(''), '');
  assert.equal(core.convert('', 'html', 'md'), '');
});

test('imported full HTML documents retain body text and tasks without head metadata', () => {
  const fullDocument = '<!doctype html><html><head><title>非表示タイトル</title><meta http-equiv="refresh" content="0;url=https://evil.example"><style>p{color:red}</style></head><body><h1>本文</h1><ul><li><input type="CHECKBOX" checked>完了</li><li><input type="checkbox">未完了</li></ul></body></html>';
  const html = core.toHTML(fullDocument, 'html');
  assert.doesNotMatch(html, /非表示タイトル|refresh|<style|<meta/);
  assert.equal(fragment(html).querySelector('h1').textContent, '本文');
  const md = core.convert(html, 'html', 'md');
  assert.match(md, /\[x\] 完了/);
  assert.match(md, /\[ \] 未完了/);
  assert.equal(fragment(core.fromMarkdown(md)).querySelectorAll('input:checked').length, 1);
});

test('filenames use the selected format and cannot accidentally include paths or reserved names', () => {
  assert.equal(core.normalizeFilename('メモ.md', 'html'), 'メモ.html');
  assert.equal(core.normalizeFilename('資料.HTML', 'md'), '資料.md');
  assert.equal(core.normalizeFilename('C:\\documents\\メモ.markdown', 'html'), 'メモ.html');
  assert.equal(core.normalizeFilename('../CON', 'md'), '_CON.md');
  assert.equal(core.normalizeFilename('   ...', 'md'), '無題のドキュメント.md');
  assert.equal(core.normalizeFilename('a<b>c?.txt', 'md'), 'abc.md');
});

test('plain text treats HTML and Markdown characters literally', () => {
  const input = '<script>alert(1)</script>\n# 見出しではない\n日本語🌱';
  const html = fragment(core.toHTML(input,'txt'));
  assert.equal(html.querySelector('pre').textContent,input);
  assert.equal(html.querySelector('script'),null);
  assert.equal(core.convert(input,'txt','txt'),input);
  assert.equal(core.normalizeFilename('メモ.md','txt'),'メモ.txt');
});

test('text export strips formatting while preserving paragraph boundaries', () => {
  const text = core.convert('# 見出し\n\n本文 **太字**\n\n- 一つ目\n- 二つ目','md','txt');
  assert.match(text,/見出し\n/);
  assert.match(text,/本文 太字/);
  assert.match(text,/一つ目\n二つ目/);
  assert.doesNotMatch(text,/<\/?[a-z]|\*\*/);
});
