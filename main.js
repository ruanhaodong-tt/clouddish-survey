'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Storage = require('./storage');
const SurveyServer = require('./server');

let win = null;
let storage = null;
let server = null;

function getDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    title: '云问卷',
    backgroundColor: '#f4f5fb',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

function broadcastStatus() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('server-status', server.status());
  }
}

function notify(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

/* ---------------- IPC: 数据 ---------------- */
ipcMain.handle('data:all', () => {
  return {
    questionnaires: storage.listQuestionnaires(),
    responses: Object.assign({}, storage.responses),
    settings: storage.getSettings(),
    serverStatus: server.status()
  };
});

ipcMain.handle('questionnaire:create', (e, data) => storage.createQuestionnaire(data));
ipcMain.handle('questionnaire:update', (e, id, data) => storage.updateQuestionnaire(id, data));
ipcMain.handle('questionnaire:delete', (e, id) => { storage.deleteQuestionnaire(id); });
ipcMain.handle('questionnaire:setShared', (e, id) => { storage.setShared(id); });
ipcMain.handle('responses:get', (e, id) => storage.getResponses(id));
ipcMain.handle('responses:clear', (e, id) => { storage.clearResponses(id); });

/* ---------------- IPC: 导出 ---------------- */
function csvEscape(v) {
  const s = Array.isArray(v) ? v.join(' | ') : String(v == null ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

ipcMain.handle('export:csv', async (e, id) => {
  const q = storage.getQuestionnaire(id);
  if (!q) throw new Error('问卷不存在');
  const rows = storage.getResponses(id);
  const header = ['提交时间', '序号', ...q.questions.map(c => c.title)];
  const lines = [header.map(csvEscape).join(',')];
  rows.forEach((r, i) => {
    const cells = [
      new Date(r.submittedAt).toLocaleString('zh-CN'),
      i + 1,
      ...q.questions.map(c => {
        const v = r.answers[c.id];
        // 将选项序号还原为文字
        if (Array.isArray(v)) {
          return v.map(x => c.options[Number(x) - 1]).filter(Boolean).join(' / ');
        }
        if (c.type === 'rating') return v == null ? '' : v + '/' + c.ratingMax + '分';
        if (c.type === 'single') return c.options[Number(v) - 1] != null ? c.options[Number(v) - 1] : (v == null ? '' : v);
        return v == null ? '' : v;
      })
    ];
    lines.push(cells.map(csvEscape).join(','));
  });
  const csv = '\ufeff' + lines.join('\n'); // BOM 便于 Excel 识别中文
  const result = await dialog.showSaveDialog(win, {
    title: '导出 CSV',
    defaultPath: q.title + '-结果.csv',
    filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return { saved: false };
  fs.writeFileSync(result.filePath, csv, 'utf8');
  return { saved: true, path: result.filePath };
});

ipcMain.handle('export:json', async (e, id) => {
  const q = storage.getQuestionnaire(id);
  if (!q) throw new Error('问卷不存在');
  const data = {
    questionnaire: q,
    responses: storage.getResponses(id)
  };
  const result = await dialog.showSaveDialog(win, {
    title: '导出 JSON',
    defaultPath: q.title + '-结果.json',
    filters: [{ name: 'JSON 文件', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { saved: false };
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
  return { saved: true, path: result.filePath };
});

/* ---------------- IPC: 服务端 ---------------- */
ipcMain.handle('server:start', async (e, port, sharedId) => {
  try {
    const st = await server.start(port, sharedId);
    broadcastStatus();
    notify('toast', { type: 'ok', text: '服务已启动' });
    return { ok: true, status: st };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('server:stop', async () => {
  await server.stop();
  broadcastStatus();
  notify('toast', { type: 'ok', text: '服务已停止' });
  return { ok: true };
});

/* ---------------- IPC: webhook 推送配置 ---------------- */
ipcMain.handle('webhook:get', () => storage.getWebhook());
ipcMain.handle('webhook:set', (e, config) => storage.setWebhook(config));

app.whenReady().then(() => {
  storage = new Storage(getDataDir());
  server = new SurveyServer(storage);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (server) server.stop();
});