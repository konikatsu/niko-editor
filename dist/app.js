(function () {
  'use strict';
  const core = window.NikoCore;
  const $ = id => document.getElementById(id);
  const visual = $('visual-editor');
  const source = $('source-editor');
  const desktop = window.desktopFiles;
  const formatLabels = {md:'Markdown', html:'HTML', txt:'テキスト'};
  const storageKey = 'niko-editor.document.v1';
  const initialHTML = '<h1>今日のアイデアノート</h1>\n<p>思いついたことを、気軽に書き留めてみましょう。<br>文字を選ぶだけで、<span style="color: #287b62;">好きな色</span>も付けられます。</p>\n<h2>まずは、ここから</h2>\n<ul><li><strong>そのまま書く。</strong> 用紙をクリックして、自由に編集。</li><li><strong>気持ちを伝える。</strong> 大切な言葉には、色や太字を。</li><li><strong>きれいに残す。</strong> Markdownでも、HTMLでも。</li></ul>\n<blockquote><p>小さなメモが、次のひらめきにつながる。</p></blockquote>\n<p><span style="background-color: #fff0b3;">大切なところは、マーカーで。</span> 自分らしく、彩ってみてください。</p>\n<hr>\n<p>この文章は自由に書き換えられます。<br>まっさらなページで始めるなら、右上の「＋ 新規」から。</p>';
  let state = {title: 'はじめてのノート', format: 'md', source: core.toMarkdown(initialHTML), view: 'visual'};
  let storageOK = true;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved.source === 'string' && ['md', 'html', 'txt'].includes(saved.format)) {
      state = {source: saved.source, format: saved.format, title: typeof saved.title === 'string' ? saved.title : '無題のノート', view: ['visual', 'source', 'preview'].includes(saved.view) ? saved.view : 'visual'};
    }
  } catch (_) { storageOK = false; }

  let history = [snapshot()];
  let historyIndex = 0;
  let historyTimer, saveTimer, previewTimer, toastTimer;
  let lastRange = null;
  let composing = false;
  let paletteMode = 'text';
  let chosenTextColor = '#287b62';
  let chosenHighlight = '#fff0b3';
  let pendingReplace = null;
  let dialogSelection = null;
  let wordWrap = true;
  let findMatches = [];
  let findIndex = -1;
  let lineFrame = 0;
  const colors = [
    ['#34433a', 'すみ色'], ['#879384', 'グレー'], ['#ffffff', '白'], ['#c96965', '赤'], ['#d59650', 'オレンジ'], ['#c3a34b', '黄'],
    ['#287b62', 'グリーン'], ['#71915d', '若草'], ['#558a9a', '青緑'], ['#5d7fb9', '青'], ['#9273b5', '紫'], ['#c17b9c', 'ピンク'],
    ['#f4d5cf', 'さくら'], ['#f7e0c0', 'あんず'], ['#fff0b3', 'レモン'], ['#dceacb', 'ミント'], ['#d4e7ef', '空'], ['#e7ddf2', 'ラベンダー']
  ];

  function snapshot() { return {title: state.title, format: state.format, source: state.source}; }
  function flushHistory() {
    clearTimeout(historyTimer);
    const next = snapshot();
    if (JSON.stringify(history[historyIndex]) !== JSON.stringify(next)) {
      history = history.slice(0, historyIndex + 1);
      history.push(next);
      if (history.length > 120) history.shift();
      historyIndex = history.length - 1;
    }
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    $('undo-button').disabled = historyIndex === 0 && JSON.stringify(history[0]) === JSON.stringify(snapshot());
    $('redo-button').disabled = historyIndex >= history.length - 1;
  }
  function undo(direction) {
    flushHistory();
    const next = historyIndex + direction;
    if (next < 0 || next >= history.length) return;
    historyIndex = next;
    Object.assign(state, history[next]);
    renderDocument();
    scheduleSave();
    updateHistoryButtons();
  }
  function changed(immediate) {
    source.value = state.source;
    updateCounts();
    scheduleSave();
    if (immediate) flushHistory();
    else { clearTimeout(historyTimer); historyTimer = setTimeout(flushHistory, 500); }
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 180);
    updateHistoryButtons();
    updateSourceInfo();
    if (!$('find-panel').hidden) refreshFind(false);
  }
  function scheduleSave() {
    $('save-status').textContent = storageOK ? '保存しています…' : '自動保存できません・ファイルに保存できます';
    $('save-dot').classList.add('pending');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 350);
  }
  function persist() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(storageKey, JSON.stringify({...snapshot(), view: state.view}));
      storageOK = true;
      $('save-status').textContent = desktop ? 'このパソコンに保存済み' : 'このブラウザに保存済み';
      $('save-dot').classList.remove('pending');
    } catch (_) {
      storageOK = false;
      $('save-status').textContent = '自動保存できません・ファイルに保存できます';
      $('save-dot').classList.add('pending');
    }
  }
  function renderDocument() {
    $('filename').value = state.title;
    $('format').value = state.format;
    source.value = state.source;
    visual.innerHTML = core.toHTML(state.source, state.format);
    lastRange = null;
    updateFormatLabels();
    setView(state.view, false);
    updateCounts();
    renderPreview();
  }
  function updateFormatLabels() {
    const label = formatLabels[state.format];
    $('source-label').textContent = state.format === 'txt' ? 'テキスト' : label + ' ソース';
    $('source-extension').textContent = '.' + state.format;
    $('format-status').textContent = label;
    $('visual-view-label').textContent = state.format === 'txt' ? 'テキスト編集' : 'かんたん編集';
    document.querySelector('button[data-view="source"]').hidden = state.format === 'txt';
    document.title = (state.title || '無題のノート') + ' — NIKO Editor';
  }
  function updateCounts() {
    const holder = document.createElement('div');
    holder.innerHTML = core.toHTML(state.source, state.format);
    const text = holder.textContent || '';
    const count = Array.from(text.replace(/\s/g, '')).length;
    $('character-count').textContent = count.toLocaleString('ja-JP') + ' 文字';
    $('reading-time').textContent = Math.max(1, Math.ceil(count / 500)) + ' 分で読めます';
  }
  function renderPreview() {
    if (state.view !== 'visual' && state.format !== 'txt' || state.view === 'preview') $('preview-frame').srcdoc = core.previewDocument(core.toHTML(state.source, state.format));
  }
  function setView(view, save = true) {
    closePopovers();
    const prior = state.view;
    if (state.format === 'txt' && view === 'source') view = 'visual';
    state.view = view;
    if (view === 'visual' && prior !== 'visual') {
      visual.innerHTML = core.toHTML(state.source, state.format);
      lastRange = null;
    }
    source.value = state.source;
    $('editor-area').dataset.view = state.format === 'txt' && view !== 'preview' ? 'text' : view;
    $('visual-scroll').hidden = view !== 'visual' || state.format === 'txt';
    $('source-panel').hidden = !isSourceEditing();
    $('preview-panel').hidden = view === 'visual';
    document.querySelectorAll('[data-view]').forEach(button => {
      if (button.tagName !== 'BUTTON') return;
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('toolbar').querySelectorAll('button:not(#undo-button):not(#redo-button),select').forEach(el => { el.disabled = view === 'preview' || state.format === 'txt'; });
    $('toolbar-tip').textContent = view === 'preview' ? '仕上がりを確認中' : state.format === 'txt' ? '文字だけで、シンプルに。' : '選んで、色付け。';
    $('cursor-position').hidden = !isSourceEditing();
    if (!isSourceEditing()) closeFind();
    updateSourceInfo();
    renderPreview();
    if (save) persist();
  }
  function syncVisual(immediate) {
    state.source = state.format === 'md' ? core.toMarkdown(visual.innerHTML) : core.sanitize(visual.innerHTML);
    changed(immediate);
  }
  function rememberRange() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount && visual.contains(selection.anchorNode) && visual.contains(selection.focusNode)) lastRange = selection.getRangeAt(0).cloneRange();
  }
  function restoreRange() {
    visual.focus({preventScroll: true});
    const selection = window.getSelection();
    if (lastRange && visual.contains(lastRange.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(lastRange);
    } else {
      const range = document.createRange();
      range.selectNodeContents(visual);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  function visualCommand(command, value) {
    flushHistory();
    restoreRange();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(command, false, value == null ? null : value);
    rememberRange();
    syncVisual(true);
    updateActiveFormats();
  }
  function updateActiveFormats() {
    if (state.view !== 'visual') return;
    for (const button of document.querySelectorAll('[data-command]')) {
      if (['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].includes(button.dataset.command)) {
        const active = document.queryCommandState(button.dataset.command);
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }
    const selection = window.getSelection();
    if (!selection || !visual.contains(selection.anchorNode)) return;
    const node = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
    const block = node.closest('h1,h2,h3,p,div');
    $('heading').value = block && /H[123]/.test(block.tagName) ? block.tagName.toLowerCase() : 'p';
  }
  function sourceWrap(before, after, placeholder = 'テキスト') {
    flushHistory();
    const start = source.selectionStart, end = source.selectionEnd;
    const selected = source.value.slice(start, end) || placeholder;
    source.setRangeText(before + selected + after, start, end, 'select');
    source.focus();
    source.setSelectionRange(start + before.length, start + before.length + selected.length);
    state.source = source.value;
    changed(true);
  }
  function sourceLines(mdPrefix, tag) {
    flushHistory();
    const start = source.selectionStart === 0 ? 0 : source.value.lastIndexOf('\n', source.selectionStart - 1) + 1;
    const selectionEnd = source.selectionEnd > source.selectionStart && source.value[source.selectionEnd - 1] === '\n' ? source.selectionEnd - 1 : source.selectionEnd;
    let end = source.value.indexOf('\n', selectionEnd);
    if (end < 0) end = source.value.length;
    const original = source.value.slice(start, end) || 'テキスト';
    const replacement = state.format === 'md' ? original.split('\n').map((line, i) => mdPrefix.replace('1.', String(i + 1) + '.') + line.replace(/^#{1,6}\s+/, '')).join('\n') : '<' + tag + '>' + original + '</' + tag + '>';
    source.setRangeText(replacement, start, end, 'select');
    state.source = source.value;
    source.focus();
    changed(true);
  }
  function isSourceEditing() { return state.view === 'source' || state.format === 'txt' && state.view !== 'preview'; }
  function updateSourceInfo() {
    if (!isSourceEditing()) return;
    const before = source.value.slice(0, source.selectionStart);
    const line = before.split('\n').length;
    const column = Array.from(before.slice(before.lastIndexOf('\n') + 1)).length + 1;
    $('cursor-position').textContent = line + ' 行、' + column + ' 列';
    cancelAnimationFrame(lineFrame);
    lineFrame = requestAnimationFrame(renderLineNumbers);
  }
  function renderLineNumbers() {
    const style = getComputedStyle(source);
    const lineHeight = parseFloat(style.lineHeight) || 24;
    const mirror = $('line-measure');
    mirror.style.width = Math.max(1, source.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0)) + 'px';
    mirror.style.font = style.font;
    mirror.style.lineHeight = style.lineHeight;
    const fragment = document.createDocumentFragment();
    for (const [index, text] of source.value.split('\n').entries()) {
      const row = document.createElement('div');
      row.textContent = String(index + 1);
      if (wordWrap && source.clientWidth > 0) {
        mirror.textContent = text || '\u200b';
        row.style.height = Math.max(lineHeight, mirror.getBoundingClientRect().height) + 'px';
      } else row.style.height = lineHeight + 'px';
      fragment.append(row);
    }
    $('line-numbers').replaceChildren(fragment);
    $('line-numbers').style.lineHeight = lineHeight + 'px';
    syncGutter();
  }
  function syncGutter() { $('line-numbers').style.transform = 'translateY(' + -source.scrollTop + 'px)'; }
  function searchRegex() {
    const query = $('find-query').value;
    if (!query) return null;
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $('find-case').checked ? 'gu' : 'giu');
  }
  function refreshFind(selectFirst) {
    const regex = searchRegex();
    findMatches = [];
    if (regex) {
      let match;
      while ((match = regex.exec(source.value)) && findMatches.length < 50000) findMatches.push([match.index, match.index + match[0].length]);
    }
    findIndex = findMatches.findIndex(([start,end]) => start === source.selectionStart && end === source.selectionEnd);
    if (selectFirst && findMatches.length) {
      findIndex = findMatches.findIndex(([start]) => start >= source.selectionStart);
      if (findIndex < 0) findIndex = 0;
      selectFindMatch(false);
    }
    updateFindCount();
  }
  function updateFindCount() {
    $('find-count').textContent = (findIndex >= 0 ? (findIndex + 1) + ' / ' : '') + findMatches.length + (findMatches.length === 50000 ? '+' : '') + ' 件';
    $('find-prev').disabled = $('find-next').disabled = $('replace-one').disabled = $('replace-all').disabled = !findMatches.length;
  }
  function selectFindMatch(focus) {
    const match = findMatches[findIndex];
    if (!match) return;
    if (focus) source.focus();
    source.setSelectionRange(match[0],match[1]);
    const line = source.value.slice(0,match[0]).split('\n').length - 1;
    const row = $('line-numbers').children[line];
    source.scrollTop = row ? Math.max(0,row.offsetTop - source.clientHeight / 2) : Math.max(0,line * 24 - source.clientHeight / 2);
    updateSourceInfo();
    updateFindCount();
  }
  function nextFind(direction) {
    if (!findMatches.length) return;
    if (findIndex < 0) findIndex = direction > 0 ? 0 : findMatches.length - 1;
    else findIndex = (findIndex + direction + findMatches.length) % findMatches.length;
    selectFindMatch(false);
  }
  function openFind(replace) {
    const selection = isSourceEditing() ? source.value.slice(source.selectionStart,source.selectionEnd) : window.getSelection().toString();
    setView(state.format === 'txt' ? 'visual' : 'source');
    $('find-panel').hidden = false;
    $('find-button').setAttribute('aria-expanded','true');
    if (selection && !selection.includes('\n')) $('find-query').value = selection;
    refreshFind(true);
    (replace ? $('replace-query') : $('find-query')).focus();
    (replace ? $('replace-query') : $('find-query')).select();
  }
  function closeFind() { $('find-panel').hidden = true; $('find-button').setAttribute('aria-expanded','false'); }
  function replaceMatches(all) {
    const regex = searchRegex();
    if (!regex || !findMatches.length) return;
    flushHistory();
    const replacement = $('replace-query').value;
    let count = 0;
    if (all) {
      source.value = source.value.replace(regex, () => { count++; return replacement; });
      source.setSelectionRange(0,0);
    } else {
      if (findIndex < 0) findIndex = 0;
      const [start,end] = findMatches[findIndex];
      source.setRangeText(replacement,start,end,'end');
      count = 1;
    }
    state.source = source.value;
    changed(true);
    refreshFind(true);
    toast(count + ' 件を置換しました');
  }
  function doCommand(command) {
    if (state.view === 'preview' || state.format === 'txt') return;
    if (state.view === 'visual') {
      if (command === 'quote') visualCommand('formatBlock', 'blockquote');
      else visualCommand(command);
    } else {
      const md = state.format === 'md';
      if (command === 'bold') sourceWrap(md ? '**' : '<strong>', md ? '**' : '</strong>');
      if (command === 'italic') sourceWrap(md ? '*' : '<em>', md ? '*' : '</em>');
      if (command === 'underline') sourceWrap('<u>', '</u>');
      if (command === 'insertUnorderedList') md ? sourceLines('- ', 'li') : sourceWrap('<ul>\n<li>', '</li>\n</ul>');
      if (command === 'insertOrderedList') md ? sourceLines('1. ', 'li') : sourceWrap('<ol>\n<li>', '</li>\n</ol>');
      if (command === 'quote') sourceLines('> ', 'blockquote');
    }
  }
  function toast(message) {
    $('toast').querySelector('span').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
  }
  function closePopovers() {
    $('color-popover').hidden = true;
    $('export-menu').hidden = true;
    for (const id of ['text-color-button', 'highlight-button', 'export-toggle']) $(id).setAttribute('aria-expanded', 'false');
  }
  function openPalette(mode, button) {
    const wasOpen = !$('color-popover').hidden && paletteMode === mode;
    closePopovers();
    if (wasOpen) return;
    rememberRange();
    paletteMode = mode;
    $('palette-title').textContent = mode === 'text' ? '文字色' : '背景色・マーカー';
    $('custom-color').value = mode === 'text' ? chosenTextColor : chosenHighlight;
    $('color-swatches').replaceChildren();
    for (const [color, name] of colors) {
      const swatch = document.createElement('button');
      swatch.className = 'swatch';
      swatch.style.backgroundColor = color;
      swatch.title = name;
      swatch.setAttribute('aria-label', name + '（' + color + '）');
      swatch.dataset.color = color;
      if (color === (mode === 'text' ? chosenTextColor : chosenHighlight)) {
        swatch.classList.add('selected');
        swatch.innerHTML = '<svg class="icon"><use href="#i-check"/></svg>';
      }
      swatch.addEventListener('click', () => applyColor(color));
      $('color-swatches').append(swatch);
    }
    const rect = button.getBoundingClientRect();
    const palette = $('color-popover');
    palette.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - 276)) + 'px';
    palette.hidden = false;
    const height = palette.getBoundingClientRect().height;
    palette.style.top = Math.max(8, Math.min(rect.bottom + 9, window.innerHeight - height - 12)) + 'px';
    button.setAttribute('aria-expanded', 'true');
  }
  function applyColor(color) {
    if (state.view === 'source') {
      const property = paletteMode === 'text' ? 'color' : 'background-color';
      sourceWrap('<span style="' + property + ': ' + color + ';">', '</span>', '色を付ける文字');
    } else visualCommand(paletteMode === 'text' ? 'foreColor' : 'hiliteColor', color);
    if (paletteMode === 'text') { chosenTextColor = color; $('text-color-indicator').style.background = color; }
    else { chosenHighlight = color; $('highlight-indicator').style.background = color; }
    closePopovers();
  }
  function escapeHTML(value) { const el = document.createElement('div'); el.textContent = value; return el.innerHTML; }
  function downloadableHTML() {
    const html = core.toHTML(state.source, state.format);
    return '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + escapeHTML(state.title || '無題のノート') + '</title>\n<style>body{max-width:760px;margin:48px auto;padding:0 24px;color:#3c4d40;font:15px/1.95 "Segoe UI","Yu Gothic UI",Meiryo,sans-serif;overflow-wrap:anywhere}h1,h2,h3{line-height:1.5}blockquote{border-left:3px solid #98b99b;padding:12px 20px;margin:24px 0;background:#f3f7ee}a{color:#287b62}pre{padding:20px;background:#f3f6ef;white-space:pre-wrap}code{font-family:Consolas,monospace}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dce4d7;padding:8px 12px}th{background:#f0f4ed}img{max-width:100%}hr{border:0;border-top:1px solid #e5eadf}mark{background:#fff0b3}li{margin:6px 0}</style>\n</head>\n<body>\n' + html + '\n</body>\n</html>\n';
  }
  async function download(format = state.format) {
    closePopovers();
    flushHistory();
    persist();
    const value = format === state.format ? state.source : format === 'html' ? downloadableHTML() : core.convert(state.source, state.format, format);
    const filename = core.normalizeFilename(state.title, format);
    if (desktop) {
      try {
        const result = await desktop.save({format, name:filename, content:value});
        if (!result || result.canceled) return false;
        if (result.error) throw new Error(result.error);
        toast(result.name + ' を保存しました');
        return true;
      } catch (error) { toast(error.message || 'ファイルを保存できませんでした'); return false; }
    }
    const blob = new Blob([value], {type: {md:'text/markdown',html:'text/html',txt:'text/plain'}[format] + ';charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast(filename + ' を書き出しました');
    return true;
  }
  function requestReplace(action, title) {
    closePopovers();
    if (!state.source.trim()) { action(); return; }
    pendingReplace = action;
    $('replace-title').textContent = title;
    $('replace-dialog').showModal();
  }
  async function finishReplace(save) {
    if (save && !await download()) return;
    $('replace-dialog').close();
    const action = pendingReplace;
    pendingReplace = null;
    if (action) action();
  }
  function replaceDocument(next) {
    flushHistory();
    Object.assign(state, next);
    renderDocument();
    changed(true);
  }
  function openLinkDialog() {
    if (state.view === 'preview') return;
    rememberRange();
    const selection = state.view === 'source' ? source.value.slice(source.selectionStart, source.selectionEnd) : lastRange ? lastRange.toString() : '';
    dialogSelection = state.view === 'source' ? [source.selectionStart, source.selectionEnd] : null;
    $('link-text').value = selection;
    $('link-url').value = '';
    $('link-dialog').showModal();
    (selection ? $('link-url') : $('link-text')).focus();
  }

  visual.addEventListener('input', () => { if (!composing) { syncVisual(false); rememberRange(); } });
  visual.addEventListener('compositionstart', () => { composing = true; });
  visual.addEventListener('compositionend', () => { composing = false; syncVisual(false); rememberRange(); });
  visual.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); });
  visual.addEventListener('paste', event => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    event.preventDefault();
    const html = clipboard.getData('text/html');
    rememberRange();
    visualCommand(html ? 'insertHTML' : 'insertText', html ? core.sanitize(html) : clipboard.getData('text/plain'));
  });
  visual.addEventListener('drop', event => { event.preventDefault(); toast('ファイルは右上の「開く」から読み込めます'); });
  source.addEventListener('input', () => { state.source = source.value; if (!composing) changed(false); });
  source.addEventListener('compositionstart', () => { composing = true; });
  source.addEventListener('compositionend', () => { composing = false; state.source = source.value; changed(false); });
  source.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      sourceWrap('  ', '', '');
      source.setSelectionRange(source.selectionEnd, source.selectionEnd);
    }
  });
  for (const event of ['click','keyup','select']) source.addEventListener(event, updateSourceInfo);
  source.addEventListener('scroll',syncGutter);
  $('wrap-button').addEventListener('click', () => {
    wordWrap = !wordWrap;
    source.wrap = wordWrap ? 'soft' : 'off';
    source.style.whiteSpace = wordWrap ? 'pre-wrap' : 'pre';
    $('wrap-button').setAttribute('aria-pressed',String(wordWrap));
    updateSourceInfo();
  });
  $('find-button').addEventListener('click', () => $('find-panel').hidden ? openFind(false) : closeFind());
  $('find-close').addEventListener('click', () => { closeFind(); source.focus(); });
  $('find-query').addEventListener('input', () => refreshFind(true));
  $('find-case').addEventListener('change', () => refreshFind(true));
  $('find-next').addEventListener('click', () => nextFind(1));
  $('find-prev').addEventListener('click', () => nextFind(-1));
  $('replace-one').addEventListener('click', () => replaceMatches(false));
  $('replace-all').addEventListener('click', () => replaceMatches(true));
  $('find-query').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); nextFind(event.shiftKey ? -1 : 1); } });
  $('replace-query').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); replaceMatches(event.ctrlKey || event.metaKey); } });
  document.addEventListener('selectionchange', () => { rememberRange(); updateActiveFormats(); });
  document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => doCommand(button.dataset.command)));
  $('toolbar').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
  $('color-popover').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
  $('heading').addEventListener('pointerdown', rememberRange);
  $('heading').addEventListener('change', event => {
    if (state.view === 'visual') visualCommand('formatBlock', event.target.value);
    else sourceLines(event.target.value === 'p' ? '' : '#'.repeat(Number(event.target.value[1])) + ' ', event.target.value);
  });
  $('text-color-button').addEventListener('click', () => openPalette('text', $('text-color-button')));
  $('highlight-button').addEventListener('click', () => openPalette('highlight', $('highlight-button')));
  $('palette-close').addEventListener('click', closePopovers);
  $('apply-custom-color').addEventListener('click', () => applyColor($('custom-color').value));
  $('clear-color').addEventListener('click', () => applyColor(paletteMode === 'text' ? '#576357' : '#ffffff'));
  $('export-toggle').addEventListener('click', () => { const open = $('export-menu').hidden; closePopovers(); $('export-menu').hidden = !open; $('export-toggle').setAttribute('aria-expanded', String(open)); });
  document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => download(button.dataset.export)));
  $('save-button').addEventListener('click', () => download());
  $('undo-button').addEventListener('click', () => undo(-1));
  $('redo-button').addEventListener('click', () => undo(1));
  $('filename').addEventListener('input', () => { state.title = $('filename').value; updateFormatLabels(); changed(false); });
  $('filename').addEventListener('blur', () => { state.title = state.title.trim() || '無題のノート'; $('filename').value = state.title; updateFormatLabels(); changed(true); });
  $('format').addEventListener('change', () => {
    const next = $('format').value;
    if (next === state.format) return;
    flushHistory();
    state.source = core.convert(state.source, state.format, next);
    state.format = next;
    renderDocument();
    changed(true);
    toast(formatLabels[next] + ' 形式に変換しました' + (next === 'txt' ? '（色や書式は解除されます）' : ''));
  });
  document.querySelectorAll('button[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('new-button').addEventListener('click', () => requestReplace(() => { replaceDocument({title:'無題のノート',source:'',format:state.format,view:'visual'}); visual.focus(); toast('新しいノートを作成しました'); }, '新しいノートを作りますか？'));
  $('open-button').addEventListener('click', async () => {
    closePopovers();
    if (!desktop) { $('file-input').click(); return; }
    try {
      const file = await desktop.open();
      if (!file || file.canceled) return;
      if (file.error) throw new Error(file.error);
      importDocument(file.name, file.content);
    } catch (error) { toast(error.message || 'ファイルを開けませんでした'); }
  });
  $('file-input').addEventListener('change', async () => {
    const file = $('file-input').files[0];
    $('file-input').value = '';
    if (!file) return;
    if (!/\.(md|markdown|html|htm|txt)$/i.test(file.name)) { toast('Markdown・HTML・テキストのファイルを選んでください'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('5 MB以下のファイルを選んでください'); return; }
    try {
      importDocument(file.name, await file.text());
    } catch (_) { toast('ファイルを読み込めませんでした。もう一度選んでください'); }
  });
  function importDocument(name, text) {
    const content = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const format = /\.(html|htm)$/i.test(name) ? 'html' : /\.txt$/i.test(name) ? 'txt' : 'md';
    requestReplace(() => { replaceDocument({title:name.replace(/\.(md|markdown|html|htm|txt)$/i,''),source:content,format,view:'visual'}); toast(name + ' を開きました'); }, 'ファイルを開きますか？');
  }
  $('replace-cancel').addEventListener('click', () => { pendingReplace = null; $('replace-dialog').close(); });
  $('replace-save').addEventListener('click', () => finishReplace(true));
  $('replace-confirm').addEventListener('click', () => finishReplace(false));
  $('replace-dialog').addEventListener('cancel', () => { pendingReplace = null; });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $('link-button').addEventListener('click', openLinkDialog);
  $('link-form').addEventListener('submit', event => {
    event.preventDefault();
    const url = $('link-url').value.trim();
    if (!/^https?:\/\//i.test(url)) { $('link-url').setCustomValidity('http:// または https:// で始まるURLを入力してください'); $('link-url').reportValidity(); return; }
    const label = $('link-text').value;
    $('link-dialog').close();
    if (state.view === 'visual') visualCommand('insertHTML', '<a href="' + escapeHTML(url).replace(/"/g, '&quot;') + '">' + escapeHTML(label) + '</a>');
    else {
      source.focus();
      if (dialogSelection) source.setSelectionRange(...dialogSelection);
      const md = state.format === 'md';
      sourceWrap('', '', '');
      const start = source.selectionStart;
      const text = md ? '[' + label.replace(/[\[\]\\]/g, '\\$&') + '](<' + url.replace(/>/g, '%3E') + '>)' : '<a href="' + escapeHTML(url).replace(/"/g, '&quot;') + '">' + escapeHTML(label) + '</a>';
      source.setRangeText(text, start, source.selectionEnd, 'end');
      state.source = source.value;
      changed(true);
    }
  });
  $('link-url').addEventListener('input', () => $('link-url').setCustomValidity(''));
  $('focus-button').addEventListener('click', () => { const active = document.body.classList.toggle('focus-mode'); $('focus-button').setAttribute('aria-pressed', String(active)); $('focus-button').title = active ? '集中モードを終了' : '集中モード'; });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#color-popover,#text-color-button,#highlight-button,.save-group')) closePopovers(); });
  document.addEventListener('keydown', event => {
    if (event.isComposing || composing) return;
    if (event.key === 'Escape') { closePopovers(); closeFind(); document.body.classList.remove('focus-mode'); $('focus-button').setAttribute('aria-pressed', 'false'); }
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const dialogOpen = !!document.querySelector('dialog[open]');
    if (dialogOpen) return;
    const inFilename = document.activeElement === $('filename');
    const inFind = !!document.activeElement.closest('#find-panel');
    if (key === 's') { event.preventDefault(); download(); }
    else if (inFind && !['f','h'].includes(key)) return;
    else if (!inFilename && key === 'z') { event.preventDefault(); undo(event.shiftKey ? 1 : -1); }
    else if (!inFilename && key === 'y') { event.preventDefault(); undo(1); }
    else if (!inFilename && ['b','i','u'].includes(key)) { event.preventDefault(); doCommand({b:'bold',i:'italic',u:'underline'}[key]); }
    else if (!inFilename && key === 'k' && state.format !== 'txt') { event.preventDefault(); openLinkDialog(); }
    else if (key === 'f' || key === 'h') { event.preventDefault(); openFind(key === 'h'); }
  });
  window.addEventListener('resize', closePopovers);
  window.addEventListener('resize', updateSourceInfo);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateSourceInfo).observe(source);
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  document.execCommand('defaultParagraphSeparator', false, 'p');
  if (desktop) $('autosave-description').textContent = '文章はこのパソコンに自動保存されます';
  renderDocument();
  updateHistoryButtons();
  persist();
})();
