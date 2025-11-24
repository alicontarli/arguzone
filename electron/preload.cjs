const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  onGlobalMute: (callback) => ipcRenderer.on('global-mute-toggle', callback),
  onAppClosing: (callback) => ipcRenderer.on('app-closing', callback) 
});