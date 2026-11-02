'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const root = path.resolve(__dirname,'..');
const key = 'niko-editor.document.v1';
function boot(options = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(fs.readFileSync(path.join(root,'dist/index.html'),'utf8'), {url:'https://editor.example/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const {window} = dom;
  window.document.execCommand = () => true;
  window.document.queryCommandState = () => false;
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open',''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  if (options.saved) window.localStorage.setItem(key,JSON.stringify({title:'テスト',format:'md',source:'',view:'visual',...options.saved}));
  if (options.storageError) Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage unavailable');}});
  if (options.desktop) window.desktopFiles = options.desktop;
  for (const file of ['vendor/marked.js','vendor/purify.js','vendor/turndown.js','vendor/turndown-plugin-gfm.js','editor-core.js','app.js']) window.eval(fs.readFileSync(path.join(root,'dist',file),'utf8'));
  const $ = id => window.document.getElementById(id);
  const click = id => $(id).click();
  const input = (id,value) => { $(id).value = value; $(id).dispatchEvent(new window.Event('input',{bubbles:true})); };
  const format = value => { $('format').value = value; $('format').dispatchEvent(new window.Event('change')); };
  const view = value => window.document.querySelector('button[data-view="'+value+'"]').click();
  return {dom,window,$,click,input,format,view,errors,close:()=>dom.window.close()};
}
test('initializes without errors and renders source and sandboxed preview', () => {
  const app = boot();
  try {
    assert.ok(app.$('visual-editor').textContent.includes('今日のアイデアノート'));
    app.view('source'); app.input('source-editor','# 日本語🌱\n\n本文'); app.view('preview');
    assert.match(app.$('preview-frame').srcdoc,/<h1>日本語🌱<\/h1>/);
    assert.equal(app.$('preview-frame').getAttribute('sandbox'),'');
    assert.deepEqual(app.errors,[]);
  } finally { app.close(); }
});
test('plain text is literal and autosave restores an empty file', () => {
  const app = boot({saved:{format:'txt',source:'<b>文字</b>\n**そのまま**'}});
  try {
    assert.equal(app.$('source-editor').value,'<b>文字</b>\n**そのまま**');
    assert.equal(app.$('source-panel').hidden,false);
    assert.equal(app.window.document.querySelector('[data-command=bold]').disabled,true);
    app.input('source-editor',''); app.window.dispatchEvent(new app.window.Event('pagehide'));
    const saved = JSON.parse(app.window.localStorage.getItem(key));
    assert.equal(saved.source,'');
    const restored = boot({saved});
    try { assert.equal(restored.$('source-editor').value,''); } finally { restored.close(); }
    assert.deepEqual(app.errors,[]);
  } finally { app.close(); }
});
test('selected text color survives format conversion and undo/redo', () => {
  const app = boot({saved:{source:'first 日本語 last',view:'source'}});
  try {
    app.$('source-editor').setSelectionRange(6,9); app.click('text-color-button');
    app.window.document.querySelector('[data-color="#c96965"]').click();
    const colored = app.$('source-editor').value;
    assert.equal(colored,'first <span style="color: #c96965;">日本語</span> last');
    app.click('undo-button'); assert.equal(app.$('source-editor').value,'first 日本語 last');
    app.click('redo-button'); assert.equal(app.$('source-editor').value,colored);
    app.format('html'); assert.match(app.$('source-editor').value,/color: rgb\(201, 105, 101\)/);
    app.click('undo-button'); assert.equal(app.$('format').value,'md'); assert.equal(app.$('source-editor').value,colored);
  } finally { app.close(); }
});
test('line tools respect a selected newline and leading empty line', () => {
  const app = boot({saved:{source:'first\nsecond\nthird',view:'source'}});
  try {
    app.$('source-editor').setSelectionRange(0,6); app.window.document.querySelector('[data-command=insertUnorderedList]').click();
    assert.equal(app.$('source-editor').value,'- first\nsecond\nthird');
    app.input('source-editor','\nnext'); app.$('source-editor').setSelectionRange(0,0); app.window.document.querySelector('[data-command=quote]').click();
    assert.equal(app.$('source-editor').value,'> テキスト\nnext'); assert.deepEqual(app.errors,[]);
  } finally { app.close(); }
});
test('background reset overrides an ancestor highlight', () => {
  const app = boot({saved:{source:'<span style="background-color:#fff0b3">hello</span>',view:'source'}});
  try {
    const start = app.$('source-editor').value.indexOf('hello'); app.$('source-editor').setSelectionRange(start,start+5);
    app.click('highlight-button'); app.click('clear-color');
    assert.match(app.$('source-editor').value,/<span style="background-color: #ffffff;">hello<\/span>/);
    const holder = app.window.document.createElement('div'); holder.innerHTML = app.window.NikoCore.toHTML(app.$('source-editor').value,'md');
    assert.equal(holder.querySelector('span span').style.backgroundColor,'rgb(255, 255, 255)');
  } finally { app.close(); }
});
test('literal find/replace handles case, symbols, Unicode and undo', () => {
  const app = boot({saved:{format:'txt',source:'A.b a.b 日本語🌱 日本語🌱'}});
  try {
    app.click('find-button'); app.input('find-query','a.b'); assert.match(app.$('find-count').textContent,/2 件/);
    app.input('replace-query','$&'); app.click('replace-all'); assert.equal(app.$('source-editor').value,'$& $& 日本語🌱 日本語🌱');
    app.click('undo-button'); assert.equal(app.$('source-editor').value,'A.b a.b 日本語🌱 日本語🌱');
    app.$('find-case').checked = true; app.$('find-case').dispatchEvent(new app.window.Event('change')); assert.match(app.$('find-count').textContent,/1 件/);
    app.input('find-query','日本語🌱'); app.input('replace-query','メモ'); app.click('replace-one'); assert.equal(app.$('source-editor').value,'A.b a.b メモ 日本語🌱');
    app.click('wrap-button'); assert.equal(app.$('source-editor').wrap,'off'); assert.deepEqual(app.errors,[]);
  } finally { app.close(); }
});
test('desktop save cancellation keeps the current document, native txt import stays literal', async () => {
  const calls = []; let cancel = true;
  const app = boot({saved:{format:'txt',source:'日本語🌱',title:'メモ'},desktop:{save:async request => { calls.push(request); return cancel?{canceled:true}:{name:request.name}; },open:async()=>({name:'sample.txt',content:'<b>literal</b>\r\n日本語'})}});
  try {
    app.click('new-button'); app.click('replace-save'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.$('source-editor').value,'日本語🌱'); assert.ok(app.$('replace-dialog').hasAttribute('open'));
    assert.deepEqual(calls.map(({name,format,content})=>[name,format,content]),[['メモ.txt','txt','日本語🌱']]);
    cancel = false; app.click('replace-save'); await new Promise(resolve=>setImmediate(resolve)); assert.equal(app.$('source-editor').value,'');
    app.click('open-button'); await new Promise(resolve=>setImmediate(resolve)); assert.equal(app.$('source-editor').value,'<b>literal</b>\n日本語'); assert.equal(app.$('format').value,'txt'); assert.deepEqual(app.errors,[]);
  } finally { app.close(); }
});
test('editor stays usable with unavailable localStorage', () => {
  const app = boot({storageError:true});
  try {
    app.view('source'); app.input('source-editor','動作します'); assert.equal(app.$('source-editor').value,'動作します'); assert.match(app.$('save-status').textContent,/自動保存できません/); assert.deepEqual(app.errors,[]);
  } finally { app.close(); }
});
