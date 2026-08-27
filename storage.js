'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function uid(prefix) {
  return (prefix || '') + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

class Storage {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.qFile = path.join(dataDir, 'questionnaires.json');
    this.rFile = path.join(dataDir, 'responses.json');
    this.sFile = path.join(dataDir, 'settings.json');
    this.questionnaires = [];
    this.responses = {}; // questionnaireId -> [response]
    this.settings = { port: 8686, sharedId: null, webhook: null, webhookLog: [] };
    this._load();
  }

  _load() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
    } catch (e) { /* ignore */ }

    try {
      const raw = this._readJson(this.qFile);
      if (Array.isArray(raw)) this.questionnaires = raw;
    } catch (e) { this.questionnaires = []; }

    try {
      const raw = this._readJson(this.rFile);
      if (raw && typeof raw === 'object') this.responses = raw;
    } catch (e) { this.responses = {}; }

    try {
      const raw = this._readJson(this.sFile);
      if (raw && typeof raw === 'object') {
        this.settings = Object.assign({ port: 8686, sharedId: null, webhook: null, webhookLog: [] }, raw);
        this.settings.webhook = Object.assign({ enabled: false, url: '', fields: ['survey', 'answers', 'stats', 'meta'], tags: {} }, raw.webhook || {});
        if (!Array.isArray(this.settings.webhookLog)) this.settings.webhookLog = [];
      }
    } catch (e) { /* defaults */ }
  }

  _readJson(file) {
    const txt = fs.readFileSync(file, 'utf8');
    return txt.trim() ? JSON.parse(txt) : null;
  }

  _write(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  _saveQ() { this._write(this.qFile, this.questionnaires); }
  _saveR() { this._write(this.rFile, this.responses); }
  _saveS() { this._write(this.sFile, this.settings); }

  // ------- questionnaires -------
  listQuestionnaires() {
    return this.questionnaires.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  getQuestionnaire(id) {
    return this.questionnaires.find(q => q.id === id) || null;
  }

  createQuestionnaire(data) {
    const q = {
      id: uid('q'),
      title: (data.title || '').trim() || '未命名问卷',
      description: (data.description || '').trim(),
      questions: this._normalizeQuestions(data.questions || []),
      createdAt: Date.now()
    };
    this.questionnaires.push(q);
    this._saveQ();
    return q;
  }

  updateQuestionnaire(id, data) {
    const q = this.getQuestionnaire(id);
    if (!q) return null;
    q.title = (data.title || '').trim() || q.title;
    if (typeof data.description === 'string') q.description = data.description.trim();
    if (Array.isArray(data.questions)) q.questions = this._normalizeQuestions(data.questions);
    this._saveQ();
    return q;
  }

  deleteQuestionnaire(id) {
    this.questionnaires = this.questionnaires.filter(q => q.id !== id);
    delete this.responses[id];
    if (this.settings.sharedId === id) {
      this.settings.sharedId = null;
      this._saveS();
    }
    this._saveQ();
    this._saveR();
  }

  _normalizeQuestions(list) {
    return list
      .filter(q => q && (q.title || '').trim())
      .map(q => ({
        id: q.id || uid('c'),
        type: ['single', 'multiple', 'text', 'rating'].includes(q.type) ? q.type : 'single',
        title: (q.title || '').trim(),
        required: !!q.required,
        options: Array.isArray(q.options) ? q.options.filter(o => String(o || '').trim()) : [],
        ratingMax: Math.min(10, Math.max(2, parseInt(q.ratingMax, 10) || 5))
      }));
  }

  // ------- responses -------
  addResponse(questionnaireId, answers) {
    if (!this.responses[questionnaireId]) this.responses[questionnaireId] = [];
    this.responses[questionnaireId].push({
      id: uid('r'),
      answers: answers || {},
      submittedAt: Date.now()
    });
    this._saveR();
    return this.responses[questionnaireId].length;
  }

  getResponses(id) {
    return (this.responses[id] || []).slice();
  }

  clearResponses(id) {
    this.responses[id] = [];
    this._saveR();
  }

  countResponses(id) {
    return (this.responses[id] || []).length;
  }

  // ------- settings -------
  getSettings() { return Object.assign({}, this.settings); }

  setPort(port) {
    port = parseInt(port, 10);
    if (!port || port < 1 || port > 65535) throw new Error('端口号无效(1-65535)');
    this.settings.port = port;
    this._saveS();
    return this.settings.port;
  }

  setShared(id) {
    this.settings.sharedId = id;
    this._saveS();
  }

  // ------- webhook -------
  getWebhook() {
    return {
      config: Object.assign({}, this.settings.webhook),
      log: (this.settings.webhookLog || []).slice()
    };
  }

  setWebhook(config) {
    const c = config || {};
    let url = String(c.url || '').trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
    this.settings.webhook = {
      enabled: !!c.enabled && !!url,
      url,
      fields: Array.isArray(c.fields) ? c.fields.filter(f => ['survey', 'answers', 'stats', 'meta'].includes(f)) : [],
      tags: (c.tags && typeof c.tags === 'object') ? c.tags : {}
    };
    this._saveS();
    return Object.assign({}, this.settings.webhook);
  }

  addWebhookLog(entry) {
    const log = this.settings.webhookLog || [];
    log.push(Object.assign({ time: Date.now() }, entry));
    while (log.length > 50) log.shift();
    this.settings.webhookLog = log;
    this._saveS();
  }
}

module.exports = Storage;