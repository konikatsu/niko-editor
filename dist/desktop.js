(function () {
  'use strict';
  if (!window.__TAURI__ || !window.__TAURI__.core) return;
  const invoke = window.__TAURI__.core.invoke;
  const auth = window.__NIKO_AUTH__;
  window.addEventListener('niko-close-request', () => {
    const canClose = window.nikoCanClose ? window.nikoCanClose() : confirm('編集画面を閉じますか？');
    if (canClose) invoke('close_editor', {auth});
  });
  window.desktopFiles = Object.freeze({
    available: true,
    open: async () => (await invoke('open_document', {auth})) || {canceled:true},
    save: async request => (await invoke('save_document', {auth,request})) || {canceled:true},
    openWork: async inputPath => await invoke('open_work_document', {auth,inputPath:inputPath||null}),
    saveWork: async request => await invoke('save_work_document', {auth,request})
  });
})();
