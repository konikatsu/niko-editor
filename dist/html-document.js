/* Canonical HTML stays inert. Only explicit edits become source-location patches. */
(function (global) {
  'use strict';
  const parser = global.NikoParser;
  const esc = value => String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const active = new Set(['script','iframe','object','embed','noscript','template','base','meta','link']);
  const sensitive = new Set(['password','file','hidden']);
  const fieldTags = new Set(['input','textarea','select']);
  function walk(node, visitor) { visitor(node); for (const child of node.childNodes || []) walk(child,visitor); }
  function attr(node,name) { return node.attrs?.find(a=>a.name === name)?.value; }
  function patch(source, edits) {
    let end = source.length;
    for (const edit of edits.sort((a,b)=>b.start-a.start)) {
      if (edit.end > end || edit.start > edit.end) throw Error('編集範囲が重なりました。ソースを確認してください。');
      source = source.slice(0,edit.start)+edit.text+source.slice(edit.end); end=edit.start;
    }
    return source;
  }
  function replaceAttr(source,node,name,value) {
    const location = node.sourceCodeLocation;
    const existing = location.attrs?.[name];
    const text = value === null ? '' : name+'="'+esc(value)+'"';
    if (existing) return {start:existing.startOffset,end:existing.endOffset,text};
    const tag = source.slice(location.startTag.startOffset,location.startTag.endOffset);
    const position = location.startTag.endOffset - (tag.endsWith('/>') ? 2 : 1);
    return {start:position,end:position,text:text ? ' '+text : ''};
  }
  function parse(source) { return parser.parse(source,{sourceCodeLocationInfo:true}); }
  class HtmlDocument {
    constructor(source) { this.setSource(source); }
    setSource(source) {
      this.source=source; this.tree=parse(source); this.nodes=[]; this.fields=[];
      walk(this.tree,node=>{
        if (!node.tagName || !node.sourceCodeLocation?.startTag) return;
        this.nodes.push(node);
        if (fieldTags.has(node.tagName) && !sensitive.has((attr(node,'type')||'text').toLowerCase()) && !['submit','button','reset','image'].includes((attr(node,'type')||'text').toLowerCase())) this.fields.push(node);
      });
      this.body=this.nodes.find(n=>n.tagName==='body');
    }
    applyFields(values) {
      const edits=[];
      this.fields.forEach((node,index)=>{
        if (!Object.hasOwn(values,index)) return;
        const value=values[index]; const type=(attr(node,'type')||'text').toLowerCase();
        if (node.tagName==='input') {
          if (type==='checkbox'||type==='radio') {
            if (typeof value !== 'boolean') throw Error('チェック状態が不正です。');
            if ((attr(node,'checked')!==undefined)!==value) edits.push(replaceAttr(this.source,node,'checked',value ? '' : null));
          } else {
            if (typeof value!=='string' || value.length>100000) throw Error('入力値が長すぎます。');
            if ((attr(node,'value')||'')!==value) edits.push(replaceAttr(this.source,node,'value',value));
          }
        } else if (node.tagName==='textarea') {
          if (typeof value!=='string'||value.length>100000) throw Error('入力値が長すぎます。');
          const old=node.childNodes.map(n=>n.value||'').join('');
          if (old!==value) {
            const loc=node.sourceCodeLocation;
            if (!loc.endTag) throw Error('textareaの終了タグをソースで修正してください。');
            edits.push({start:loc.startTag.endOffset,end:loc.endTag.startOffset,text:(value.startsWith('\n')?'\n':'')+esc(value)});
          }
        } else {
          if (!Array.isArray(value)||value.some(v=>!Number.isInteger(v))) throw Error('選択値が不正です。');
          const options=[];walk(node,n=>{if(n.tagName==='option')options.push(n);});
          options.forEach((option,i)=>{if ((attr(option,'selected')!==undefined)!==value.includes(i)) edits.push(replaceAttr(this.source,option,'selected',value.includes(i)?'':null));});
        }
      });
      if (edits.length) this.setSource(patch(this.source,edits));
      return edits.length>0;
    }
    createView() {
      const marker='data-niko-'+global.crypto.randomUUID().replace(/-/g,'');
      const marked=this.nodes.map((node,i)=>replaceAttr(this.source,node,marker,String(i)));
      const doc=new global.DOMParser().parseFromString(patch(this.source,marked),'text/html');
      const originals=new Map(); const protectedIds=[];
      for (const element of [...doc.querySelectorAll('['+marker+']')]) {
        const id=element.getAttribute(marker), node=this.nodes[Number(id)];
        originals.set(id,{node,attributes:[...element.attributes].map(a=>[a.name,a.value])});
        if (active.has(element.localName)) {
          const placeholder=doc.createElement('span');placeholder.setAttribute(marker,id);placeholder.setAttribute('contenteditable','false');placeholder.hidden=true;
          element.replaceWith(placeholder);protectedIds.push(id);continue;
        }
        for(const a of [...element.attributes]) {
          if (/^on/i.test(a.name) || /^(?:href|src|srcset|action|formaction|xlink:href|poster|background)$/i.test(a.name)) {
            if (!(a.name==='href'&&a.value.startsWith('#'))) element.removeAttribute(a.name);
          }
          if (a.name==='autofocus'||a.name==='contenteditable') element.removeAttribute(a.name);
        }
        if (fieldTags.has(element.localName)||element.localName==='button'||element.localName==='style') {
          protectedIds.push(id);element.setAttribute('contenteditable','false');
        }
        if ((element.localName==='input'&&sensitive.has(element.type))||element.localName==='button') element.disabled=true;
      }
      const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';
      csp.content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
      doc.head.prepend(csp);
      return {html:'<!doctype html>'+doc.documentElement.outerHTML,marker,originals,protectedIds};
    }
    readFields(doc,view) {
      const values={};
      this.fields.forEach((node,index)=>{
        const id=this.nodes.indexOf(node);const element=doc.querySelector('['+view.marker+'="'+id+'"]');
        if (!element) throw Error('入力欄が失われました。編集を取り消してください。');
        values[index]=element.localName==='select' ? [...element.options].flatMap((o,i)=>o.selected?[i]:[]) : (element.type==='checkbox'||element.type==='radio') ? element.checked : element.value;
      });return values;
    }
    commitView(doc,baseline,view) {
      if (!this.body?.sourceCodeLocation.endTag) throw Error('本文の開始・終了タグが必要です。HTMLソースで編集してください。');
      const selector='['+view.marker+']';
      const originalProtected=view.protectedIds.filter(id=>baseline.body.querySelector('['+view.marker+'="'+id+'"]'));
      const currentProtected=[...doc.body.querySelectorAll(selector)].map(n=>n.getAttribute(view.marker)).filter(id=>view.protectedIds.includes(id));
      if (JSON.stringify(originalProtected)!==JSON.stringify(currentProtected)) throw Error('入力欄やスクリプトを含む範囲は削除できません。元に戻してから保存してください。');
      for (const id of originalProtected) {
        const before=baseline.querySelector('['+view.marker+'="'+id+'"]'),after=doc.querySelector('['+view.marker+'="'+id+'"]');
        if (!after?.isEqualNode(before)) throw Error('入力欄や保護された要素を変更できません。元に戻してください。');
      }
      const serialize=node=>{
        if (node.nodeType!==1) return node.nodeType===3 ? esc(node.textContent).replace(/&quot;/g,'"') : '<!--'+node.textContent+'-->';
        const id=node.getAttribute(view.marker), record=view.originals.get(id);
        if (record && view.protectedIds.includes(id)) {const loc=record.node.sourceCodeLocation;return this.source.slice(loc.startOffset,loc.endOffset);}
        const copy=node.cloneNode(false);copy.removeAttribute(view.marker);
        if(record) for(const [name,value] of record.attributes) {
          if (name===view.marker)continue;
          if (/^on/i.test(name)||/^(?:href|src|srcset|action|formaction|xlink:href|poster|background|autofocus|contenteditable)$/i.test(name)) copy.setAttribute(name,value);
        }
        copy.innerHTML=[...node.childNodes].map(serialize).join('');return copy.outerHTML;
      };
      const edits=[];
      const diff=(before,after)=>{
        if(before.isEqualNode(after))return;
        const id=before.nodeType===1 ? before.getAttribute(view.marker) : null;
        const record=view.originals.get(id),loc=record?.node.sourceCodeLocation;
        const sameAttrs=before.nodeType===1&&after.nodeType===1&&before.cloneNode(false).isEqualNode(after.cloneNode(false));
        const sameChildren=before.childNodes.length===after.childNodes.length&&[...before.childNodes].every((a,i)=>{
          const b=after.childNodes[i];return a.nodeType===b.nodeType&&(a.nodeType!==1||a.getAttribute(view.marker)===b.getAttribute(view.marker));
        });
        if(sameAttrs&&sameChildren){
          // Text nodes have no view marker; patch their original source locations through parse5.
          const rawChildren=record?.node.childNodes||[];
          [...before.childNodes].forEach((a,i)=>{
            const b=after.childNodes[i];
            if(a.nodeType===3&&!a.isEqualNode(b)&&rawChildren[i]?.sourceCodeLocation){const l=rawChildren[i].sourceCodeLocation;edits.push({start:l.startOffset,end:l.endOffset,text:serialize(b)});}
            else if(!a.isEqualNode(b))diff(a,b);
          });return;
        }
        if(!loc) throw Error('文書構造が変わりました。ソースを確認してください。');
        if(record.node.tagName==='body') edits.push({start:loc.startTag.endOffset,end:loc.endTag.startOffset,text:[...after.childNodes].map(serialize).join('')});
        else edits.push({start:loc.startOffset,end:loc.endOffset,text:serialize(after)});
      };
      diff(baseline.body,doc.body);
      if(edits.length)this.setSource(patch(this.source,edits));
      return edits.length>0;
    }
  }
  global.NikoHtml={HtmlDocument,patch};
})(globalThis);
