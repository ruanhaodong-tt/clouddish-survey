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

// 统计：与管理端图表逻辑保持一致，供 /api/stats 与 webhook 使用
function computeStats(survey, rows) {
  const total = rows.length;
  const byQuestion = {};
  survey.questions.forEach(c => {
    if (c.type === 'text') {
      byQuestion[c.id] = {
        type: c.type, title: c.title,
        texts: rows.map(r => r.answers[c.id]).filter(v => v != null && String(v).trim() !== '')
      };
      return;
    }
    if (c.type === 'rating') {
      const distribution = {};
      for (let i = 1; i <= c.ratingMax; i++) distribution[String(i)] = 0;
      rows.forEach(r => {
        const v = r.answers[c.id];
        if (v != null && v !== '') distribution[String(v)] = (distribution[String(v)] || 0) + 1;
      });
      let sum = 0, n = 0;
      Object.keys(distribution).forEach(k => { sum += distribution[k] * Number(k); n += distribution[k]; });
      byQuestion[c.id] = {
        type: c.type, title: c.title, ratingMax: c.ratingMax,
        distribution, average: n ? +(sum / n).toFixed(2) : 0
      };
      return;
    }
    const map = {};
    rows.forEach(r => {
      const v = r.answers[c.id];
      if (Array.isArray(v)) v.forEach(x => { const k = String(x); map[k] = (map[k] || 0) + 1; });
      else if (v != null && v !== '') { const k = String(v); map[k] = (map[k] || 0) + 1; }
    });
    byQuestion[c.id] = {
      type: c.type, title: c.title,
      options: c.options.map((label, idx) => ({ option: label, index: idx + 1, count: map[String(idx + 1)] || 0 }))
    };
  });
  return { total, byQuestion };
}

// 答卷答案转为可读文本
function readableAnswers(survey, response) {
  const out = {};
  survey.questions.forEach(c => {
    const v = response.answers[c.id];
    if (v == null || v === '') return;
    if (Array.isArray(v)) {
      out[c.id] = { type: c.type, title: c.title, value: v.map(x => c.options[Number(x) - 1]).filter(Boolean) };
    } else if (c.type === 'rating') {
      out[c.id] = { type: c.type, title: c.title, value: Number(v) };
    } else if (c.type === 'single') {
      out[c.id] = { type: c.type, title: c.title, value: c.options[Number(v) - 1] || v };
    } else {
      out[c.id] = { type: c.type, title: c.title, value: v };
    }
  });
  return out;
}

class SurveyServer {
  constructor(storage, options) {
    this.storage = storage;
    this.adminToken = (options && options.adminToken) || '';
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

  _clientIp(req) {
    return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  }

  _authOk(req) {
    if (!this.adminToken) return false;
    const h = String(req.headers['authorization'] || '');
    const x = String(req.headers['x-admin-token'] || '');
    return h === 'Bearer ' + this.adminToken || x === this.adminToken;
  }

  _pushWebhook(survey, response, total, from) {
    const wh = this.storage.getSettings().webhook;
    if (!wh || !wh.enabled || !wh.url) return;
    const fields = Array.isArray(wh.fields) && wh.fields.length ? wh.fields : ['survey', 'answers', 'stats', 'meta'];
    const payload = { event: 'response_created' };
    if (fields.includes('survey')) payload.survey = { id: survey.id, title: survey.title, description: survey.description, questions: survey.questions };
    if (fields.includes('answers')) payload.answers = readableAnswers(survey, response);
    if (fields.includes('stats')) payload.stats = computeStats(survey, this.storage.getResponses(survey.id));
    if (fields.includes('meta')) payload.meta = { submitId: response.id, submittedAt: response.submittedAt, total, from };
    const tags = wh.tags && typeof wh.tags === 'object' ? wh.tags : {};
    Object.keys(tags).forEach(k => {
      const v = tags[k];
      if (v !== '' && v != null) payload[k] = v;
    });

    const req = http.request(wh.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        this.storage.addWebhookLog({ ok: res.statusCode >= 200 && res.statusCode < 300, code: res.statusCode, body: body.slice(0, 200) });
      });
    });
    req.on('error', (err) => {
      this.storage.addWebhookLog({ ok: false, error: String((err && err.message) || err).slice(0, 200) });
    });
    req.on('timeout', () => {
      req.destroy();
      this.storage.addWebhookLog({ ok: false, error: '推送超时(5s)' });
    });
    req.write(JSON.stringify(payload));
    req.end();
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
        const all = this.storage.getResponses(survey.id);
        const last = all[all.length - 1];
        if (last) this._pushWebhook(survey, last, count, this._clientIp(req));
        return this._send(res, 200, { ok: true, total: count });
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/survey') {
      const survey = this.storage.getQuestionnaire(sharedId);
      if (!survey) return this._send(res, 404, { error: '问卷不存在或尚未分享' });
      return this._send(res, 200, {
        ok: true,
        survey: { id: survey.id, title: survey.title, description: survey.description, questions: survey.questions, createdAt: survey.createdAt },
        responses: this.storage.countResponses(survey.id)
      });
    }

    if (req.method === 'GET' && pathname === '/api/responses') {
      const survey = this.storage.getQuestionnaire(sharedId);
      if (!survey) return this._send(res, 404, { error: '问卷不存在或尚未分享' });
      const rows = this.storage.getResponses(survey.id);
      return this._send(res, 200, {
        ok: true,
        total: rows.length,
        responses: rows.map(r => ({ id: r.id, submittedAt: r.submittedAt, answers: r.answers }))
      });
    }

    if (req.method === 'GET' && pathname === '/api/stats') {
      const survey = this.storage.getQuestionnaire(sharedId);
      if (!survey) return this._send(res, 404, { error: '问卷不存在或尚未分享' });
      const stats = computeStats(survey, this.storage.getResponses(survey.id));
      return this._send(res, 200, Object.assign({ ok: true }, stats));
    }

    // ---- 内置管理页与管理 API（写操作需 admin token）----
    if (req.method === 'GET' && pathname === '/admin') {
      try {
        const html = fs.readFileSync(path.join(__dirname, 'admin-page.html'), 'utf8');
        return this._send(res, 200, html, true);
      } catch (e) {
        return this._send(res, 500, { error: '管理页文件缺失: admin-page.html' });
      }
    }

    if (pathname.startsWith('/api/admin/')) {
      if (!this._authOk(req)) return this._send(res, 401, { error: '未授权：缺少或错误的 admin token' });

      if (req.method === 'GET' && pathname === '/api/admin/surveys') {
        const sid = this.storage.getSettings().sharedId;
        return this._send(res, 200, {
          ok: true,
          sharedId: sid,
          surveys: this.storage.listQuestionnaires().map(q => ({
            id: q.id, title: q.title, createdAt: q.createdAt, count: this.storage.countResponses(q.id)
          }))
        });
      }

      if (req.method === 'GET' && pathname === '/api/admin/survey') {
        const id = url.searchParams.get('id');
        const q = id ? this.storage.getQuestionnaire(id) : null;
        if (!q) return this._send(res, 404, { error: '问卷不存在' });
        return this._send(res, 200, { ok: true, survey: q });
      }

      if (req.method === 'GET' && pathname === '/api/admin/webhook') {
        return this._send(res, 200, Object.assign({ ok: true }, this.storage.getWebhook()));
      }

      if (req.method === 'DELETE' && pathname === '/api/admin/survey') {
        const id = url.searchParams.get('id');
        if (!id) return this._send(res, 400, { error: '缺少 id 参数' });
        this.storage.deleteQuestionnaire(id);
        return this._send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && ['/api/admin/survey', '/api/admin/share', '/api/admin/webhook'].includes(pathname)) {
        let body = '';
        let size = 0;
        req.on('data', (chunk) => { size += chunk.length; if (size > 1048576) req.destroy(); else body += chunk; });
        req.on('end', () => {
          let payload;
          try { payload = JSON.parse(body || '{}'); } catch (e) { return this._send(res, 400, { error: '请求格式错误' }); }

          if (pathname === '/api/admin/survey') {
            const id = payload.id;
            if (id) {
              const q = this.storage.updateQuestionnaire(id, payload);
              if (!q) return this._send(res, 404, { error: '问卷不存在' });
              if (payload.setShared !== false) this.storage.setShared(q.id);
              return this._send(res, 200, { ok: true, id: q.id });
            }
            const q = this.storage.createQuestionnaire(payload);
            if (payload.setShared !== false) this.storage.setShared(q.id);
            return this._send(res, 200, { ok: true, id: q.id });
          }

          if (pathname === '/api/admin/share') {
            const id = payload.id;
            const q = this.storage.getQuestionnaire(id);
            if (!q) return this._send(res, 404, { error: '问卷不存在' });
            this.storage.setShared(id);
            return this._send(res, 200, { ok: true, id });
          }

          if (pathname === '/api/admin/webhook') {
            const saved = this.storage.setWebhook(payload);
            return this._send(res, 200, { ok: true, config: saved });
          }
        });
        return;
      }

      return this._send(res, 404, { error: '管理接口不存在' });
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