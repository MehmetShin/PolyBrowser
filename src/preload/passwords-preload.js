const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('polyPasswordsAPI', {
  getInitial: () => ipcRenderer.invoke('passwords:page-initial'),
  list: () => ipcRenderer.invoke('passwords:list'),
  reveal: (id) => ipcRenderer.invoke('passwords:reveal', id),
  save: (entry) => ipcRenderer.invoke('passwords:save', entry),
  remove: (id) => ipcRenderer.invoke('passwords:delete', id),
  clearAll: () => ipcRenderer.invoke('passwords:clear-all'),
  checkup: () => ipcRenderer.invoke('passwords:checkup'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  saveProfile: (profile) => ipcRenderer.invoke('autofill:save-profile', profile),
  importCsv: () => ipcRenderer.invoke('import:pick-csv'),
  exportCsv: () => ipcRenderer.invoke('import:export-passwords-csv')
});

