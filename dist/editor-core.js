(function (global) {
  'use strict';

  const document = global.document;
  const allowedTags = [
    'p', 'div', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
    'pre', 'code', 'strong', 'b', 'em', 'i', 's', 'del', 'strike', 'u', 'mark',
    'span', 'font', 'sub', 'sup', 'small', 'a', 'img', 'ul', 'ol', 'li', 'dl',
    'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'colgroup', 'col', 'input', 'figure', 'figcaption', 'details', 'summary',
    'section', 'article', 'header', 'footer', 'main', 'aside', 'address', 'abbr',
    'kbd', 'samp', 'var', 'q', 'cite', 'time'
  ];
  const allowedAttributes = [
    'href', 'title', 'src', 'alt', 'width', 'height', 'style', 'color', 'align',
    'class', 'colspan', 'rowspan', 'scope', 'start', 'reversed', 'value',
    'type', 'checked', 'disabled', 'open', 'datetime'
  ];
  const styleValidators = {
    'color': colorValue,
    'background-color': colorValue,
    'text-align': value => /^(left|right|center|justify|start|end)$/.test(value),
    'font-weight': value => /^(normal|bold|bolder|lighter|[1-9]00)$/.test(value),
    'font-style': value => /^(normal|italic|oblique)$/.test(value),
    'text-decoration': value => /^(none|underline|line-through|overline)(\s+(underline|line-through|overline))*$/.test(value),
    'text-decoration-line': value => /^(none|underline|line-through|overline)(\s+(underline|line-through|overline))*$/.test(value),
    'white-space': value => /^(normal|pre|pre-wrap|pre-line|break-spaces)$/.test(value),
    'vertical-align': value => /^(baseline|sub|super|middle|top|bottom|text-top|text-bottom)$/.test(value),
    'font-size': value => /^(?:[89]|[1-6]\d|7[0-2])px$|^(?:0\.[5-9]|[1-3](?:\.\d{1,2})?|4)(?:em|rem)$/.test(value),
    'list-style-type': value => /^(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none)$/.test(value)
  };

  function colorValue(value) {
    if (!value || /[;{}\\]|url\s*\(|var\s*\(|expression\s*\(/i.test(value)) return false;
    const probe = document.createElement('span');
    probe.style.color = value;
    return Boolean(probe.style.color);
  }

  function safeUrl(value, image) {
    const compact = String(value || '').replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
    if (!compact) return false;
    if (image && /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(compact)) return true;
    if (image && /^blob:https?:\/\//i.test(compact)) return true;
    if (/^[a-z][a-z\d+.-]*:/i.test(compact)) return image ? /^https?:/i.test(compact) : /^(https?:|mailto:|tel:)/i.test(compact);
    return !compact.startsWith('\\');
  }

  function cleanStyles(element) {
    const original = element.style;
    const clean = document.createElement('span').style;
    for (let i = 0; i < original.length; i++) {
      const property = original[i].toLowerCase();
      const value = original.getPropertyValue(property).trim().toLowerCase();
      if (styleValidators[property] && styleValidators[property](value)) clean.setProperty(property, value);
    }
    const align = element.getAttribute('align');
    if (align && styleValidators['text-align'](align.toLowerCase())) clean.textAlign = align.toLowerCase();
    const legacyColor = element.getAttribute('color');
    if (legacyColor && colorValue(legacyColor)) clean.color = legacyColor;
    element.removeAttribute('align');
    element.removeAttribute('color');
    if (clean.cssText) element.setAttribute('style', clean.cssText);
    else element.removeAttribute('style');
  }

  function sanitize(html) {
    const fragment = global.DOMPurify.sanitize(String(html == null ? '' : html), {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: allowedAttributes,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
      FORBID_CONTENTS: ['script', 'style', 'title', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math'],
      SANITIZE_DOM: true
    });
    for (const element of fragment.querySelectorAll('*')) {
      cleanStyles(element);
      if (element.hasAttribute('href') && !safeUrl(element.getAttribute('href'), false)) element.removeAttribute('href');
      if (element.hasAttribute('src') && !safeUrl(element.getAttribute('src'), true)) element.removeAttribute('src');
      if (element.hasAttribute('class')) {
        const classes = element.className.split(/\s+/).filter(name => /^(language-[a-z\d_+-]+|task-list-item|contains-task-list)$/.test(name));
        if (classes.length) element.className = classes.join(' ');
        else element.removeAttribute('class');
      }
      for (const attribute of ['width', 'height', 'colspan', 'rowspan']) {
        if (element.hasAttribute(attribute)) {
          const value = element.getAttribute(attribute);
          const limit = attribute === 'width' || attribute === 'height' ? 4000 : 100;
          if (!/^\d{1,4}$/.test(value) || Number(value) < 1 || Number(value) > limit) element.removeAttribute(attribute);
        }
      }
      if (element.tagName === 'A' && element.hasAttribute('href')) {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      }
      if (element.tagName === 'IMG') {
        element.setAttribute('loading', 'lazy');
        element.setAttribute('referrerpolicy', 'no-referrer');
      }
      if (element.tagName === 'INPUT') {
        if (element.type !== 'checkbox') {
          element.remove();
          continue;
        }
        element.disabled = true;
        element.setAttribute('tabindex', '-1');
      }
    }
    const container = document.createElement('div');
    container.appendChild(fragment);
    return container.innerHTML;
  }

  function fromMarkdown(markdown) {
    const parsed = global.marked.parse(String(markdown == null ? '' : markdown), { gfm: true, breaks: true, async: false });
    return sanitize(parsed);
  }

  let markdownService;
  function getMarkdownService() {
    if (markdownService) return markdownService;
    markdownService = new global.TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      fence: '```',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined'
    });
    if (global.turndownPluginGfm && global.turndownPluginGfm.gfm) markdownService.use(global.turndownPluginGfm.gfm);
    // Markdown has no native color or alignment syntax. Keep the safe HTML for
    // these nodes, including their children, so switching formats loses no color.
    markdownService.addRule('preservePresentation', {
      filter: node => /^(SPAN|FONT|MARK|U|SUB|SUP|SMALL)$/.test(node.nodeName) || node.hasAttribute('style'),
      replacement: (content, node) => node.isBlock ? '\n\n' + node.outerHTML + '\n\n' : node.outerHTML
    });
    markdownService.keep(['figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd', 'abbr', 'kbd', 'samp', 'var', 'q', 'cite', 'time']);
    return markdownService;
  }

  function toMarkdown(html) {
    return getMarkdownService().turndown(sanitize(html));
  }

  function isMarkdown(format) {
    return !format || /^(md|markdown)$/i.test(format);
  }

  function toHTML(source, format) {
    if (format === 'txt') {
      const element = document.createElement('pre');
      element.textContent = String(source == null ? '' : source);
      element.style.whiteSpace = 'pre-wrap';
      return element.outerHTML;
    }
    return isMarkdown(format) ? fromMarkdown(source) : sanitize(source);
  }

  function plainText(html) {
    const container = document.createElement('div');
    container.innerHTML = sanitize(html);
    function read(node) {
      if (node.nodeType === 3) {
        if (/^\s*$/.test(node.textContent) && /^(UL|OL|TABLE|THEAD|TBODY|TFOOT|TR)$/.test(node.parentElement.tagName)) return '';
        return node.textContent;
      }
      if (node.nodeType !== 1) return '';
      if (node.tagName === 'BR' || node.tagName === 'HR') return '\n';
      if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
      const content = Array.from(node.childNodes, read).join('');
      if (/^(P|DIV|H[1-6]|BLOCKQUOTE|PRE|LI|TR|SECTION|ARTICLE|UL|OL)$/.test(node.tagName)) return content.replace(/\n*$/, '') + '\n';
      if (/^(TD|TH)$/.test(node.tagName)) return content + '\t';
      return content;
    }
    return read(container).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  }

  function convert(source, from, to) {
    const value = String(source == null ? '' : source);
    if (from === to) return value;
    if (to === 'txt') return from === 'txt' ? value : plainText(toHTML(value, from));
    if (from === 'txt') return isMarkdown(to) ? toMarkdown(toHTML(value, 'txt')) : toHTML(value, 'txt');
    if (isMarkdown(from) && isMarkdown(to)) return value;
    if (isMarkdown(to)) return toMarkdown(value);
    return toHTML(value, from);
  }

  function normalizeFilename(name, format) {
    const extension = format === 'txt' ? '.txt' : isMarkdown(format) ? '.md' : '.html';
    let filename = String(name || '').split(/[\\/]/).pop()
      .replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '')
      .replace(/\.(?:md|markdown|html|htm|txt)$/i, '').replace(/[.\s]+$/g, '').trim();
    if (!filename) filename = '無題のドキュメント';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = '_' + filename;
    return filename.slice(0, 180) + extension;
  }

  const previewCSS = `
    :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif;color:#243631;background:#fff;font-synthesis:none}
    *{box-sizing:border-box}body{margin:0;padding:48px 52px 80px;font-size:15px;line-height:1.95;overflow-wrap:anywhere}
    main{max-width:760px;margin:0 auto}h1,h2,h3,h4,h5,h6{color:#203b31;line-height:1.5;font-weight:700;margin:1.7em 0 .75em;letter-spacing:.01em}
    h1{font-size:2em;margin-top:0}h2{font-size:1.5em;padding-bottom:.35em;border-bottom:1px solid #e7ece8}h3{font-size:1.18em}
    p{margin:0 0 1em}ul,ol{padding-left:1.6em;margin:.6em 0 1.25em}li+li{margin-top:.3em}li>p{margin:.3em 0}a{color:#268465;text-decoration:underline;text-underline-offset:3px;cursor:default}
    blockquote{margin:1.4em 0;padding:.7em 1.3em;border-left:3px solid #7ba58f;color:#65756c;background:#f4f8f5}blockquote p:last-child{margin-bottom:0}
    code,kbd,samp,pre{font-family:Consolas,"SFMono-Regular",Menlo,monospace}code{font-size:.88em;padding:.2em .4em;background:#eef3ef;border-radius:4px}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:18px 22px;background:#f1f5f2;border:1px solid #e4ebe5;border-radius:8px;line-height:1.7}pre code{padding:0;background:none;border:0;border-radius:0;font-size:.88em}
    table{border-collapse:collapse;width:100%;margin:1.4em 0;font-size:.94em}th,td{border:1px solid #dfe7e1;padding:10px 14px;text-align:left}th{background:#f2f6f3;font-weight:600}tr:nth-child(even) td{background:#fafcfb}
    hr{border:0;border-top:1px solid #e3eae5;margin:2em 0}img{max-width:100%;height:auto;border-radius:6px}figure{margin:1.5em 0}figcaption{font-size:.85em;color:#718077;text-align:center}
    mark{background:#fff0a6;color:inherit;padding:.05em .12em}input[type=checkbox]{accent-color:#478367;margin-right:.4em;vertical-align:middle}details{padding:1em;border:1px solid #e3eae5;border-radius:6px}summary{font-weight:600}
    @media(max-width:560px){body{padding:28px 24px 60px;font-size:14px}h1{font-size:1.75em}th,td{padding:7px 9px}}
    @media print{body{padding:0;font-size:11pt}pre,blockquote,table{break-inside:avoid}}
  `;

  function previewDocument(html) {
    const container = document.createElement('div');
    container.innerHTML = sanitize(html);
    for (const link of container.querySelectorAll('a')) {
      link.removeAttribute('href');
      link.removeAttribute('target');
      link.removeAttribute('rel');
    }
    // This document is intended for an iframe with an empty sandbox attribute.
    // CSP also prevents image/CSS network requests even if an imported file
    // contains an external resource. Only embedded bitmap images can display.
    return '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'">' +
      '<title>ドキュメントのプレビュー</title><style>' + previewCSS + '</style></head><body><main>' + container.innerHTML + '</main></body></html>';
  }

  global.NikoCore = Object.freeze({sanitize, fromMarkdown, toMarkdown, toHTML, convert, previewDocument, normalizeFilename});
})(window);
