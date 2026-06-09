const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  printTicket: async (data) => {
    console.log('printTicket appelé depuis preload');
    const result = await ipcRenderer.invoke('print-ticket', data);
    console.log('print-ticket result:', result);
    return result;
  },
  printWifi: (data) => ipcRenderer.invoke('print-wifi', data),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});

console.log('Preload chargé !');
