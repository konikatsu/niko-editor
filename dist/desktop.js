(function () {
  'use strict';
  if (!window.__TAURI__ || !window.__TAURI__.core) return;
  const invoke = window.__TAURI__.core.invoke;
  window.desktopFiles = Object.freeze({
    open: async () => (await invoke('open_document')) || {canceled:true},
    save: async request => (await invoke('save_document', {request})) || {canceled:true}
  });
})();
