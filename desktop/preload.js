'use strict';
// 提供 shared/gm-shim.js 需要的 UepaBridge；實際的儲存與下載在 main.js 處理。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('UepaBridge', {
  getValue: (key) => ipcRenderer.sendSync('uepa:get', String(key)),
  setValue: (key, value) => {
    ipcRenderer.sendSync('uepa:set', String(key), String(value));
  },
  httpGet: (url, id) => {
    ipcRenderer.send('uepa:http', String(url), Number(id));
  },
});
