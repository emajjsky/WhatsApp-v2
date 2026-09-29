const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopRuntime', {
  platform: process.platform,
  appVersion: () => ipcRenderer.invoke('desktop-app:version'),
  getConfig: () => ipcRenderer.invoke('desktop-config:get'),
  saveConfig: (config) => ipcRenderer.invoke('desktop-config:save', config),
  getRememberedLogin: () => ipcRenderer.invoke('desktop-auth:get-remembered-login'),
  saveRememberedLogin: (payload) => ipcRenderer.invoke('desktop-auth:save-remembered-login', payload),
  notifyIncomingCall: (payload) => ipcRenderer.invoke('desktop-notify:incoming-call', payload),
})
