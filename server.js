'use strict';
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'survey-template.html'), 'utf8');

function renderQuestionnairePage(q) {
  const safeTitle = String(q.title || '问卷').replace(/</g, '\\u003c');
  const optionsJson = JSON.stringify(q.questions)
    .replace(/</g, '\\u003c').replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return TEMPLATE
    .replace('__TITLE__', safeTitle)
    .replace('__QUESTIONS__', optionsJson)
    .replace('__QID__', JSON.stringify(q.id))
    .replace('__BASE__', JSON.stringify('/'));
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

class SurveyServer {
  constructor(storage) {
    this.storage = storage;
    this.server = null;
    this.port = storage.getSettings().port;
  }

  _collectIp() {
    const list = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) list.push(net.address);
      }
    }
    return list;
  }

  isRunning() { return !!this.server && this.server.listening; }

  status() {
    return {
      running: this.isRunning(),
      port: this.isRunning() ? this.port : null,
      sharedId: this.storage.getSettings().sharedId,
      addresses: this._collectIp()
    };
  }

  start(port, sharedId) {
    if (this.isRunning()) throw new Error('服务已在运行，请先停止');
    const p = this.storage.setPort(port);
    if (sharedId) this.storage.setShared(sharedId);
    this.port = p;

    const server = http.createServer((req, res) => this._handle(req, res));
    this.server = server;

    return new Promise((resolve, reject) => {
      server.on('error', (err) => {
        this.server = null;
        if (err.code === 'EADDRINUSE') reject(new Error('端口 ' + p + ' 已被占用，请更换端口'));
        else if (err.code === 'EACCES') reject(new Error('无权监听端口 ' + p + '，请尝试 1024 以上端口'));
        else reject(err);
      });
      server.listen(p, '0.0.0.0', () => {
        resolve(this.status());
      });
    });
  }

  stop() {
    if (!this.server) return Promise.resolve(false);
    return new Promise((resolve) => {
      const srv = this.server;
      this.server = null;
      srv.close(() => resolve(true));
      setTimeout(() => srv.closeAllConnections && srv.closeAllConnections(), 300);
    });
  }

  _send(res, code, obj, html) {
    res.writeHead(code, {
      'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(html ? obj : JSON.stringify(obj));
  }

  _handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const sharedId = this.storage.getSettings().sharedId;

    if (req.method === 'OPTIONS') return this._send(res, 204, {});

    if (req.method === 'GET' && ['/', '/q', '/index'].includes(pathname)) {
      const survey = this.storage.getQuestionnaire(sharedId);
      if (!survey) return this._send(res, 404, { error: '问卷不存在或尚未分享，请联系管理员开启分享' });
      return this._send(res, 200, renderQuestionnairePage(survey), true);
    }

    if (req.method === 'POST' && pathname === '/submit') {
      let body = '';
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2097152) req.destroy();
        else body += chunk;
      });
      req.on('end', () => {
        let payload;
        try { payload = JSON.parse(body); } catch (e) { return this._send(res, 400, { error: '请求格式错误' }); }
        const survey = this.storage.getQuestionnaire(payload && payload.id);
        if (!survey) return this._send(res, 404, { error: '问卷不存在' });
        const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};
        const clean = {};
        survey.questions.forEach((c) => {
          if (Object.prototype.hasOwnProperty.call(answers, c.id)) clean[c.id] = answers[c.id];
        });
        const count = this.storage.addResponse(survey.id, clean);
        return this._send(res, 200, { ok: true, total: count });
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      const survey = this.storage.getQuestionnaire(sharedId);
      return this._send(res, 200, { ok: true, running: true, survey: survey ? survey.title : null });
    }

    return this._send(res, 404, { error: '路径不存在' });
  }
}

module.exports = SurveyServer;
module.exports.esc = esc;