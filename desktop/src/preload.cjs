const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopRuntime', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('desktop-config:get'),
  saveConfig: (config) => ipcRenderer.invoke('desktop-config:save', config),
})
