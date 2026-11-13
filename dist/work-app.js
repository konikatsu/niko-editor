(function () {
  'use strict';
  const $=id=>document.getElementById(id),frame=$('document'),source=$('source');
  const initial='<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<title>作業メモ</title>\n<style>body{font:16px/1.9 "Yu Gothic UI",sans-serif;max-width:880px;margin:48px auto;padding:0 32px;color:#273c43}h1{font-size:28px}label{display:block;margin:14px 0}input[type=text],textarea{font:inherit;padding:7px;border:1px solid #ccd8dd;border-radius:4px}textarea{width:100%;min-height:130px}</style>\n</head>\n<body>\n<h1>作業メモ</h1>\n<p>「本文を編集」で文字を選ぶと、色やマーカーを付けられます。</p>\n<label><input type="checkbox" id="task-1"> 最初の作業を確認する</label>\n<label><input type="checkbox" id="task-2"> 結果を記録する</label>\n<label>担当者 <input type="text" id="operator"></label>\n<label>申し送り<textarea id="handoff"></textarea></label>\n</body>\n</html>\n';
  let model=new NikoHtml.HtmlDocument(initial),savedSource='',mode='work',view,baseline,session=null,handle=null,browserBytes=null,encoding='UTF-8',busy=false,composing=false,pendingSave=false,range=null,history=[],future=[],sourceInitial='',sourceMixed=false,viewReady=false;
  const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
  function currentText(){return mode==='source'&&source.value!==sourceInitial?source.value:model.source;}
  function dirty(){return currentText()!==savedSource||(viewReady&&mode==='edit'&&baseline&&!frame.contentDocument.body.isEqualNode(baseline.body))||(viewReady&&mode==='work'&&view&&baseline&&JSON.stringify(model.readFields(frame.contentDocument,view))!==JSON.stringify(model.readFields(baseline,view)));}
  function indicators(){
    const changed=dirty();$('dirty').textContent=changed?'未保存':'保存済み';$('dirty').classList.toggle('saved',!changed);document.title=(changed?'● ':'')+($('file-name').textContent)+' — NIKO Editor';
    const checks=mode==='source'?[]:[...frame.contentDocument.querySelectorAll('input[type=checkbox]')];$('progress').textContent='チェック '+checks.filter(n=>n.checked).length+' / '+checks.length;
  }
  function flush(){
    const previous=model.source;
    if(mode==='source'&&source.value!==sourceInitial){
      if(sourceMixed&&!confirm('元の改行が混在しています。ソース編集後の改行はLFに統一します。続けますか？'))throw Error('ソースの反映を中止しました。');
      const crlf=model.source.includes('\r\n')&&!/(?:^|[^\r])\n/.test(model.source);
      model.setSource(crlf?source.value.replace(/\n/g,'\r\n'):source.value);sourceInitial=source.value;
    }else if(viewReady&&view&&mode!=='source'){
      if(mode==='work'){
        const values=model.readFields(frame.contentDocument,view),before=model.readFields(baseline,view);
        const changed=Object.fromEntries(Object.entries(values).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(before[key])));
        model.applyFields(changed);
      }else{model.commitView(frame.contentDocument,baseline,view);}
    }
    if(previous!==model.source){history.push(previous);if(history.length>80)history.shift();future=[];}
  }
  function onKey(event){
    if(!(event.ctrlKey||event.metaKey))return;
    const key=event.key.toLowerCase();
    if(key==='s'){event.preventDefault();if(composing||event.isComposing)pendingSave=true;else save(event.shiftKey);}
    if(key==='o'){event.preventDefault();open();}
    if(mode==='edit'&&['b','i','u'].includes(key)){event.preventDefault();command({b:'bold',i:'italic',u:'underline'}[key]);}
  }
  function bindFrame(){
    const doc=frame.contentDocument;
    doc.addEventListener('keydown',onKey);
    doc.addEventListener('compositionstart',()=>composing=true);
    doc.addEventListener('compositionend',()=>{composing=false;if(pendingSave){pendingSave=false;setTimeout(()=>save(),0);}});
    doc.addEventListener('selectionchange',()=>{const selection=frame.contentWindow.getSelection();if(selection.rangeCount&&!selection.isCollapsed)range=selection.getRangeAt(0).cloneRange();});
    doc.addEventListener('submit',e=>e.preventDefault(),true);
    doc.addEventListener('click',e=>{
      const link=e.target.closest('a');if(link){e.preventDefault();const target=link.getAttribute('href');if(target?.startsWith('#'))doc.getElementById(target.slice(1))?.scrollIntoView();}
      if(mode==='edit'&&e.target.closest('label,input,textarea,select,button'))e.preventDefault();
    },true);
    doc.addEventListener('paste',e=>{if(mode==='edit'){e.preventDefault();doc.execCommand('insertText',false,e.clipboardData.getData('text/plain'));}});
    doc.addEventListener('drop',e=>e.preventDefault());
    doc.addEventListener('input',()=>{indicators();status('変更があります。保存するとHTMLに反映します。');});
    doc.addEventListener('change',indicators);
    if(mode==='edit')doc.designMode='on';
    const style=doc.createElement('style');style.textContent=mode==='edit'?'input,textarea,select,button{pointer-events:none!important}body{outline:none} [contenteditable=false]{user-select:none}':'button,input[type=submit],input[type=reset],input[type=image],input[type=file]{pointer-events:none!important}';doc.head.append(style);
    baseline=doc.cloneNode(true);viewReady=true;indicators();
  }
  function render(){
    viewReady=false;range=null;source.hidden=mode!=='source';frame.hidden=mode==='source';$('format').hidden=mode!=='edit';
    document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===mode));
    $('mode-help').textContent={work:'チェックと記入ができます。保存するとHTMLに残ります。',edit:'文字を選んで色付け。入力欄は作業モードで操作できます。',source:'HTML全体を編集できます。スクリプトは実行しません。'}[mode];
    if(mode==='source'){source.value=model.source;sourceInitial=source.value;sourceMixed=model.source.includes('\r\n')&&/(?:^|[^\r])\n/.test(model.source);indicators();return;}
    view=model.createView();frame.onload=bindFrame;frame.srcdoc=view.html;
  }
  function command(name,value){
    if(mode!=='edit'||composing)return;
    frame.contentWindow.focus();const selection=frame.contentWindow.getSelection();
    if(range){selection.removeAllRanges();selection.addRange(range);}
    if(!selection.rangeCount||selection.isCollapsed){status('本文の文字を選んでから操作してください。');return;}
    const selected=selection.getRangeAt(0);
    for(const element of frame.contentDocument.querySelectorAll('[contenteditable=false]'))if(selected.intersectsNode(element)){status('入力欄を含まない文字を選んでください。',true);return;}
    frame.contentDocument.execCommand(name,false,value);indicators();
  }
  async function decode(bytes){
    const a=new Uint8Array(bytes);encoding=a[0]===255&&a[1]===254?'UTF-16 LE':a[0]===254&&a[1]===255?'UTF-16 BE':a[0]===239&&a[1]===187&&a[2]===191?'UTF-8 BOM':'UTF-8';
    try{return new TextDecoder(encoding==='UTF-16 LE'?'utf-16le':encoding==='UTF-16 BE'?'utf-16be':'utf-8',{fatal:true}).decode(a);}catch{throw Error('UTF-8またはBOM付きUTF-16のHTMLを選んでください。');}
  }
  function encode(text){
    if(encoding.startsWith('UTF-16')){const a=new Uint8Array(2+text.length*2),big=encoding.endsWith('BE');a.set(big?[254,255]:[255,254]);const dv=new DataView(a.buffer);for(let i=0;i<text.length;i++)dv.setUint16(2+i*2,text.charCodeAt(i),!big);return a;}
    const bytes=new TextEncoder().encode(text);if(encoding==='UTF-8 BOM'){const a=new Uint8Array(bytes.length+3);a.set([239,187,191]);a.set(bytes,3);return a;}return bytes;
  }
  const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  function sizeCheck(bytes){if(bytes.byteLength>5*1024*1024)throw Error('5 MB以下のHTMLファイルを選んでください。');}
  function adopt(content,name,path){model.setSource(content);savedSource=content;history=[];future=[];$('file-name').textContent=name;$('file-path').textContent=path||'ブラウザで選択したファイル';$('file-path').title=path||name;$('encoding').textContent=encoding;mode='work';render();status('開きました。チェックや記入をして、保存できます。');}
  function canDiscard(){return !dirty()||confirm('未保存の変更があります。変更を破棄して開きますか？');}
  async function open(path){
    if(busy||!canDiscard())return;
    try{
      if(window.desktopFiles?.available){const result=await desktopFiles.openWork(path);if(!result)return;session=result;handle=null;encoding=result.encoding;adopt(result.content,result.name,result.path);}
      else if(path){status('パスを貼り付けて開く機能はexe版で使えます。ブラウザ版では「開く」で共有フォルダのファイルを選んでください。');}
      else if(window.showOpenFilePicker){const [picked]=await showOpenFilePicker({types:[{description:'HTML',accept:{'text/html':['.html','.htm']}}],multiple:false});const file=await picked.getFile();sizeCheck(file);const bytes=await file.arrayBuffer();const content=await decode(bytes);handle=picked;browserBytes=bytes;session=null;adopt(content,file.name);}
      else $('upload').click();
    }catch(e){if(e.name!=='AbortError')status(String(e.message||e),true);}
  }
  async function save(saveAs=false){
    if(busy)return;if(composing){pendingSave=true;return;}
    busy=true;$('save').disabled=true;
    try{
      flush();const content=model.source;render();document.querySelector('main').inert=true;
      if(window.desktopFiles?.available){const result=await desktopFiles.saveWork({name:$('file-name').textContent+'.html',content,sessionId:session?.sessionId||null,fingerprint:session?.fingerprint||null,saveAs});if(!result)return;session=result;$('file-name').textContent=result.name;$('file-path').textContent=result.path;$('file-path').title=result.path;savedSource=content;status('保存しました。'+(result.backupPath?' バックアップ: '+result.backupPath:''));}
      else{
        const bytes=encode(content);sizeCheck(bytes);
        if(!window.showSaveFilePicker){download(bytes,$('file-name').textContent.endsWith('.html')?$('file-name').textContent:'作業メモ.html');status('HTMLをダウンロードしました。元ファイルへの保存は確認していません。');render();return;}
        let target=handle;
        if(!target||saveAs)target=await showSaveFilePicker({suggestedName:$('file-name').textContent.replace(/\.html?$/i,'')+'.html',types:[{description:'HTML',accept:{'text/html':['.html']}}]});
        const currentFile=await target.getFile();sizeCheck(currentFile);const old=await currentFile.arrayBuffer();
        if(handle&&await target.isSameEntry(handle)&&browserBytes&&await hash(old)!==await hash(browserBytes))throw Error('他のアプリが元ファイルを変更しました。「名前を付けて保存」で別ファイルに保存してください。');
        if(old.byteLength&&await hash(old)!==await hash(bytes)){
          download(old,currentFile.name+'.niko-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak');
          if(!confirm('上書き前のバックアップをダウンロードしました。ダウンロード先に保存できたことを確認してから、HTMLを上書きしますか？'))return;
        }
        const writable=await target.createWritable();try{await writable.write(bytes);await writable.close();}catch(e){try{await writable.abort();}catch{}throw e;}
        const verified=await (await target.getFile()).arrayBuffer();if(await hash(verified)!==await hash(bytes))throw Error('保存後の内容を確認できませんでした。編集内容を別名で保存してください。');
        handle=target;browserBytes=verified;savedSource=content;$('file-name').textContent=target.name;status('保存しました。');
      }
      render();
    }catch(e){if(e.name!=='AbortError')status(String(e.message||e),true);}
    finally{busy=false;document.querySelector('main').inert=false;$('save').disabled=false;indicators();}
  }
  function download(bytes,name){const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function undo(redo=false){try{flush();const stack=redo?future:history;if(!stack.length)return;const value=stack.pop();(redo?history:future).push(model.source);model.setSource(value);render();status(redo?'やり直しました。':'元に戻しました。');}catch(e){status(e.message,true);}}
  $('open').onclick=()=>open();$('open-path').onclick=()=>open($('path').value);$('path').onkeydown=e=>{if(e.key==='Enter')open($('path').value);};$('save').onclick=()=>save();$('save-as').onclick=()=>save(true);
  $('upload').onchange=async()=>{try{const file=$('upload').files[0];if(!file)return;sizeCheck(file);const bytes=await file.arrayBuffer(),content=await decode(bytes);session=null;handle=null;browserBytes=bytes;adopt(content,file.name);}catch(e){status(e.message,true);}finally{$('upload').value='';}};
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(mode===b.dataset.mode||busy)return;try{flush();mode=b.dataset.mode;render();}catch(e){status(e.message,true);}});
  document.querySelectorAll('[data-command]').forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>command(b.dataset.command);});
  $('text-color').oninput=e=>command('foreColor',e.target.value);$('highlight-color').oninput=e=>command('hiliteColor',e.target.value);$('clear-format').onmousedown=e=>e.preventDefault();$('clear-format').onclick=()=>command('removeFormat');
  $('undo').onclick=()=>undo();$('redo').onclick=()=>undo(true);$('print').onclick=()=>{if(mode==='source'){status('作業モードに切り替えてから印刷してください。');return;}frame.contentWindow.focus();frame.contentWindow.print();};
  $('notes').onclick=e=>{if(!canDiscard())e.preventDefault();};
  document.addEventListener('keydown',onKey);source.addEventListener('input',indicators);
  source.addEventListener('compositionstart',()=>composing=true);source.addEventListener('compositionend',()=>{composing=false;if(pendingSave){pendingSave=false;setTimeout(()=>save(),0);}});
  window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
  window.nikoCanClose=()=>!busy&&(!dirty()||confirm('未保存の変更があります。保存せずに閉じますか？'));
  $('environment').textContent=window.desktopFiles?.available?'デスクトップ版':'ブラウザ版';
  render();
})();
