const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dcFencePlanner', {
  saveProject: (project) => ipcRenderer.invoke('dialog:saveProject', project),
  openProject: () => ipcRenderer.invoke('dialog:openProject'),
});
