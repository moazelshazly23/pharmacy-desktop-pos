const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  all: (sql, params) => ipcRenderer.invoke('db:all', sql, params || []),
  run: (sql, params) => ipcRenderer.invoke('db:run', sql, params || []),
  tx: (ops) => ipcRenderer.invoke('db:tx', ops),
  backup: () => ipcRenderer.invoke('app:backup'),
  restore: () => ipcRenderer.invoke('app:restore'),
  info: () => ipcRenderer.invoke('app:info'),
  chooseBackupDir: (clear) => ipcRenderer.invoke('app:chooseBackupDir', !!clear),
  openBackups: () => ipcRenderer.invoke('app:openBackups'),
  print: () => ipcRenderer.invoke('app:print'),
});
