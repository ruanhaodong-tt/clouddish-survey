'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 数据
  loadAll: () => ipcRenderer.invoke('data:all'),
  createQuestionnaire: (d) => ipcRenderer.invoke('questionnaire:create', d),
  updateQuestionnaire: (id, d) => ipcRenderer.invoke('questionnaire:update', id, d),
  deleteQuestionnaire: (id) => ipcRenderer.invoke('questionnaire:delete', id),
  setShared: (id) => ipcRenderer.invoke('questionnaire:setShared', id),
  getResponses: (id) => ipcRenderer.invoke('responses:get', id),
  clearResponses: (id) => ipcRenderer.invoke('responses:clear', id),
  // 导出
  exportCsv: (id) => ipcRenderer.invoke('export:csv', id),
  exportJson: (id) => ipcRenderer.invoke('export:json', id),
  // 服务端
  serverStart: (port, sharedId) => ipcRenderer.invoke('server:start', port, sharedId),
  serverStop: () => ipcRenderer.invoke('server:stop'),
  // webhook 推送配置
  webhookGet: () => ipcRenderer.invoke('webhook:get'),
  webhookSet: (config) => ipcRenderer.invoke('webhook:set', config),
  // 事件
  onServerStatus: (cb) => ipcRenderer.on('server-status', (e, s) => cb(s)),
  onToast: (cb) => ipcRenderer.on('toast', (e, t) => cb(t))
});