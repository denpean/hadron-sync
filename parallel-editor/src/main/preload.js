'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  importFile: () => ipcRenderer.invoke('import-file'),
  openProject: () => ipcRenderer.invoke('open-project'),
  saveProject: (data, saveAs) => ipcRenderer.invoke('save-project', data, saveAs),
  exportFile: (markdown, suggestedName) => ipcRenderer.invoke('export-file', markdown, suggestedName),
  closeNow: () => ipcRenderer.send('close-now'),
  setDirty: (dirty, name) => ipcRenderer.send('set-dirty', dirty, name),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd, arg) => cb(cmd, arg)),
});
