// The only thing the page can reach: requests to the app's local engine (see engine/api.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('woodpecker', {
  request: (method, path, body) => ipcRenderer.invoke('api', method, path, body),
});
