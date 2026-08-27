'use strict';
const bridge = window.api;

const state = {
  questionnaires: [],
  responses: {},
  settings: { port: 8686, sharedId: null },
  server: { running: false, port: null, sharedId: null, addresses: [] },
  editing: null,      // {id:null}=新建, {id}=编辑
  draftQuestions: []
};

const $ = (s) => document.querySelector(s);
const TYPE_NAME = { single: '单选题', multiple: '多选题', text: '填空题', rating: '评分题' };

/* ---------------- 通用 ---------------- */
function toast(text, type) {
  const t = $('#toast');
  t.textContent = text;
  t.className = 'show ' + (type || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, 2400);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function fmtTime(t) {
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
    ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function showView(name) {
  ['detailView', 'editorView', 'emptyView'].forEach(v => $('#' + v).classList.add('hidden'));
  $('#emptyView').classList.add('hidden');
  if (name === 'empty') $('#emptyView').classList.remove('hidden');
  else $('#' + name + 'View').classList.remove('hidden');
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('已复制链接', 'ok')).catch(() => manualCopy(text));
  } else manualCopy(text);
}
function manualCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('已复制链接', 'ok'); } catch (e) { toast('复制失败，请手动复制'); }
  ta.remove();
}

/* ---------------- 列表 ---------------- */
function renderList() {
  const list = $('#qList');
  $('#qCount').textContent = state.questionnaires.length + ' 份';
  list.innerHTML = '';
  if (!state.questionnaires.length) {
    const li = document.createElement('li');
    li.className = 'q-item';
    li.style.color = 'var(--muted)';
    li.textContent = '暂无问卷';
    list.appendChild(li);
    return;
  }
  state.questionnaires.forEach(q => {
    const li = document.createElement('li');
    li.className = 'q-item' + (state.selected && state.selected === q.id ? ' active' : '');
    const isShared = state.settings.sharedId === q.id;
    li.innerHTML =
      '<div class="q-item-name">' + esc(q.title) + '</div>' +
      '<div class="q-item-meta">' +
        '<span>' + q.questions.length + ' 题</span>' +
        '<span>' + (state.responses[q.id] || []).length + ' 份答卷</span>' +
        (isShared ? '<span class="share-tag">分享中</span>' : '') +
      '</div>';
    li.onclick = () => openDetail(q.id);
    list.appendChild(li);
  });
}

function renderSharedSelect() {
  const sel = $('#sharedSelect');
  sel.innerHTML = '';
  if (!state.questionnaires.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '（暂无问卷）';
    sel.appendChild(o);
    return;
  }
  state.questionnaires.forEach(q => {
    const o = document.createElement('option');
    o.value = q.id; o.textContent = q.title;
    sel.appendChild(o);
  });
  const cur = state.settings.sharedId && state.questionnaires.find(q => q.id === state.settings.sharedId);
  if (cur) sel.value = cur.id;
}

function renderShareCard() {
  const s = state.server;
  const dot = $('#serverDot'), stateEl = $('#serverState'), toggle = $('#serverToggle');
  dot.className = 'dot' + (s.running ? ' on' : '');
  stateEl.textContent = s.running ? '服务运行中 · 端口 ' + s.port : '服务未启动';
  toggle.textContent = s.running ? '停止服务' : '启动服务';
  $('#portInput').value = state.settings.port;

  const urls = $('#urls');
  urls.innerHTML = '';
  if (s.running && s.port) {
    ['localhost', ...s.addresses].forEach(ip => {
      const url = 'http://' + ip + ':' + s.port + '/';
      const div = document.createElement('div');
      div.className = 'url-line';
      div.innerHTML = '<code>http://' + esc(ip) + ':' + s.port + '/</code><button class="copy-btn">复制</button>';
      div.querySelector('.copy-btn').onclick = () => copyText(url);
      urls.appendChild(div);
    });
  } else {
    const d = document.createElement('div');
    d.className = 'url-empty';
    d.textContent = s.running ? '' : '启动后显示访客访问链接';
    urls.appendChild(d);
  }
  renderSharedSelect();
}

/* ---------------- 详情/统计 ---------------- */
function openDetail(id) {
  state.selected = id;
  const q = state.questionnaires.find(x => x.id === id);
  if (!q) return;
  renderList();
  renderShareCard();
  showView('detail');
  $('#detailTitle').textContent = q.title;
  $('#detailMeta').textContent = '共 ' + q.questions.length + ' 题 · ' + (state.responses[id] || []).length + ' 份答卷 · 创建于 ' + fmtTime(q.createdAt);
  renderStats(q);
  renderResponses(q);
}

function countAnswers(rows, qid) {
  const map = {};
  rows.forEach(r => {
    const v = r.answers[qid];
    if (Array.isArray(v)) v.forEach(x => { const k = String(x); map[k] = (map[k] || 0) + 1; });
    else if (v != null && v !== '') { const k = String(v); map[k] = (map[k] || 0) + 1; }
  });
  return map;
}

function legendHTML(pairs, total, paletteColored) {
  let html = '';
  pairs.forEach((p, i) => {
    const color = paletteColored ? Charts.palette[i % Charts.palette.length] : 'var(--primary)';
    const pct = total ? Math.round((p.value / total) * 100) + '%' : '-';
    html += '<div class="legend-row"><span class="legend-color" style="background:' + color + '"></span><span class="legend-name">' + esc(p.label) + '</span><span class="legend-val">' + p.value + ' 票 · ' + pct + '</span></div>';
  });
  return html;
}

function renderStats(q) {
  const rows = state.responses[q.id] || [];
  const total = rows.length;
  const body = $('#statsBody');
  body.innerHTML = '';

  if (!total) {
    body.innerHTML = '<div class="stat-card"><div class="empty-tip">还没有答卷数据，启动服务并分享链接给访客后，数据将在这里以图表呈现。</div></div>';
    return;
  }

  q.questions.forEach(c => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    let inner = '<div class="stat-title">' + esc(c.title) + '</div><div class="stat-sub">' + TYPE_NAME[c.type] + ' · 回答 ' + total + ' 人</div>';

    if (c.type === 'text') {
      const texts = rows.map(r => r.answers[c.id]).filter(v => v != null && String(v).trim() !== '');
      inner += '<div class="text-answers">' +
        (texts.length ? texts.map(t => '<div class="text-answer">' + esc(t) + '</div>').join('') : '<div class="empty-tip">暂无文本作答</div>') +
        '</div>';
      card.innerHTML = inner;
      body.appendChild(card);
      return;
    }

    if (c.type === 'rating') {
      const dist = [];
      for (let i = 1; i <= c.ratingMax; i++) dist.push({ label: String(i), value: countAnswers(rows, c.id)[String(i)] || 0 });
      const sum = dist.reduce((s, d) => s + d.value * Number(d.label), 0);
      const avg = sum ? (sum / total).toFixed(1) : '-';
      card.innerHTML = inner + '<div class="chart-wrap">' +
        '<canvas class="chart-canvas" style="width:340px"></canvas>' +
        '<div class="chart-legend"><div style="margin-bottom:8px;">平均评分：<b>' + avg + ' / ' + c.ratingMax + '</b></div>' + legendHTML(dist, total, false) + '</div>' +
        '</div>';
      body.appendChild(card);
      const canvas = card.querySelector('canvas');
      const items = dist.filter(d => d.value > 0).map(d => ({ label: d.label + ' 分', value: d.value }));
      Charts.barChart(canvas, items);
      return;
    }

    // single / multiple
    const map = countAnswers(rows, c.id);
    const pairsWithData = c.options.map((label, idx) => ({ label, value: map[String(idx + 1)] || 0 })).filter(p => p.value > 0);
    const pairsAll = c.options.map((label, idx) => ({ label, value: map[String(idx + 1)] || 0 }));
    if (c.type === 'single') {
      card.innerHTML = inner + '<div class="chart-wrap">' +
        '<canvas class="chart-canvas"></canvas>' +
        '<div class="chart-legend">' + legendHTML(pairsAll.filter(p => p.value > 0), total, true) + '</div>' +
        '</div>';
      body.appendChild(card);
      Charts.pieChart(card.querySelector('canvas'), pairsWithData);
      return;
    }
    // multiple
    card.innerHTML = inner + '<div class="chart-wrap">' +
      '<canvas class="chart-canvas" style="width:360px"></canvas>' +
      '<div class="chart-legend">' + legendHTML(pairsAll.filter(p => p.value > 0), total, false) + '</div>' +
      '</div>';
    body.appendChild(card);
    Charts.barChart(card.querySelector('canvas'), pairsWithData);
  });
}

function renderResponses(q) {
  const rows = state.responses[q.id] || [];
  const body = $('#responseBody');
  if (!rows.length) {
    body.innerHTML = '<div class="responses-card"><div class="empty-tip">暂无答卷记录</div></div>';
    return;
  }
  const rev = rows.slice().reverse();
  let html = '<div class="responses-card"><div style="font-weight:600;margin-bottom:8px;">答卷明细（' + rows.length + ' 份）</div>';
  rev.forEach(r => {
    html += '<div class="response-item"><div class="response-head">' + fmtTime(r.submittedAt) + '</div>';
    q.questions.forEach((c, i) => {
      let v = r.answers[c.id];
      if (v == null || v === '') return;
      let display;
      if (Array.isArray(v)) display = v.map(x => c.options[Number(x) - 1]).filter(Boolean).join('、');
      else if (c.type === 'rating') display = v + '/' + c.ratingMax + '分';
      else if (c.type === 'single') display = c.options[Number(v) - 1] || v;
      else display = v;
      html += '<div class="response-q"><span class="qn">' + (i + 1) + '.</span><b>' + esc(c.title) + '</b>：' + esc(display) + '</div>';
    });
    html += '</div>';
  });
  html += '</div>';
  body.innerHTML = html;
}

/* ---------------- 编辑器 ---------------- */
function openEditor(q) {
  if (q) {
    state.editing = { id: q.id };
    $('#editorTitle').textContent = '编辑问卷';
    $('#qTitle').value = q.title;
    $('#qDesc').value = q.description || '';
    state.draftQuestions = q.questions.map(c => Object.assign({}, c));
  } else {
    state.editing = { id: null };
    $('#editorTitle').textContent = '新建问卷';
    $('#qTitle').value = '';
    $('#qDesc').value = '';
    state.draftQuestions = [];
  }
  renderEditorQuestions();
  showView('editor');
}

function addQuestion(type) {
  const q = {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type, title: '', required: false,
    options: type === 'rating' ? [] : ['', ''],
    ratingMax: 5
  };
  state.draftQuestions.push(q);
  renderEditorQuestions();
}

function renderEditorQuestions() {
  const body = $('#editorQuestions');
  body.innerHTML = '';
  state.draftQuestions.forEach((c, idx) => body.appendChild(qEditNode(c, idx)));
}

function qEditNode(c, idx) {
  const div = document.createElement('div');
  div.className = 'q-edit';
  div.dataset.id = c.id;

  let bodyHtml = '';
  if (c.type === 'rating') {
    bodyHtml = '<div class="rating-max"><span>最高分</span><input type="number" data-role="ratingMax" min="2" max="10" value="' + c.ratingMax + '"></div>';
  } else if (c.type !== 'text') {
    let opts = '';
    c.options.forEach((o, oi) => {
      opts += '<div class="opt-row" data-oi="' + oi + '">' +
        '<span class="drag">&#8942;</span>' +
        '<input type="text" data-role="opt" value="' + esc(o) + '" placeholder="选项内容 ' + (oi + 1) + '">' +
        '<button class="opt-del" data-act="optDel">&#10005;</button>' +
        '</div>';
    });
    bodyHtml = '<div class="opts-list">' + opts + '</div>' +
      '<button class="btn small" data-act="addOpt">+ 添加选项</button>';
  }

  div.innerHTML =
    '<div class="q-edit-head">' +
      '<span class="q-edit-type">' + TYPE_NAME[c.type] + '</span>' +
      '<div class="q-edit-title"><input type="text" data-role="title" value="' + esc(c.title) + '" placeholder="请输入题目"></div>' +
      '<button class="q-del" data-act="del">&#10005;</button>' +
    '</div>' +
    '<div class="q-edit-body">' + bodyHtml + '</div>' +
    '<div class="q-req"><input type="checkbox" data-role="req" ' + (c.required ? 'checked' : '') + '><label>必答</label></div>';

  div.querySelector('[data-role=title]').addEventListener('input', (e) => { c.title = e.target.value; });
  div.querySelector('[data-role=req]').addEventListener('change', (e) => { c.required = e.target.checked; });

  div.querySelectorAll('[data-role=opt]').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const oi = Number(e.target.closest('.opt-row').dataset.oi);
      c.options[oi] = e.target.value;
    });
  });

  const ratingMax = div.querySelector('[data-role=ratingMax]');
  if (ratingMax) ratingMax.addEventListener('input', (e) => { c.ratingMax = Number(e.target.value) || 5; });

  div.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    if (act === 'del') {
      state.draftQuestions = state.draftQuestions.filter(x => x.id !== c.id);
      renderEditorQuestions();
    } else if (act === 'addOpt') {
      c.options.push('');
      renderEditorQuestions();
    } else if (act === 'optDel') {
      const row = e.target.closest('.opt-row');
      const oi = Number(row.dataset.oi);
      c.options.splice(oi, 1);
      renderEditorQuestions();
    }
  });

  // 上/下移动
  if (c.type !== 'text' && c.type !== 'rating' && c.options.length) {
    const body = div.querySelector('.q-edit-body');
    body.insertAdjacentHTML('beforeend', '<button class="btn small" data-act="moveUp">上移</button> <button class="btn small" data-act="moveDown">下移</button>');
    div.querySelector('[data-act=moveUp]').onclick = (e) => {
      e.stopPropagation();
      const cur = state.draftQuestions.indexOf(c);
      if (cur > 0) { swap(cur, cur - 1); renderEditorQuestions(); }
    };
    div.querySelector('[data-act=moveDown]').onclick = (e) => {
      e.stopPropagation();
      const cur = state.draftQuestions.indexOf(c);
      if (cur < state.draftQuestions.length - 1) { swap(cur, cur + 1); renderEditorQuestions(); }
    };
  }
  return div;
}

function swap(a, b) {
  const arr = state.draftQuestions;
  const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
}

async function saveEditor() {
  const title = $('#qTitle').value.trim();
  const description = $('#qDesc').value.trim();
  if (!title) return toast('请填写问卷标题', 'err');
  const questions = state.draftQuestions
    .map(c => ({
      id: c.id, type: c.type, title: c.title ? c.title.trim() : '',
      required: c.required, options: c.options ? c.options.map(o => String(o || '').trim()) : [],
      ratingMax: c.ratingMax
    }))
    .filter(c => c.title);
  if (!questions.length) return toast('请至少添加一道题目', 'err');

  const data = { title, description, questions };
  if (state.editing && state.editing.id) {
    const q = await bridge.updateQuestionnaire(state.editing.id, data);
    const idx = state.questionnaires.findIndex(x => x.id === q.id);
    state.questionnaires[idx] = q;
    toast('问卷已保存', 'ok');
    openDetail(q.id);
  } else {
    const q = await bridge.createQuestionnaire(data);
    state.questionnaires.push(q);
    toast('问卷已创建', 'ok');
    openDetail(q.id);
  }
  renderList();
  renderShareCard();
}

/* ---------------- 服务端控制 ---------------- */
async function toggleServer() {
  if (state.server.running) {
    const r = await bridge.serverStop();
    state.server.running = false;
    renderShareCard();
    return;
  }
  const port = Number($('#portInput').value);
  const sharedId = $('#sharedSelect').value;
  if (!sharedId) return toast('请先选择要分享的问卷', 'err');
  const r = await bridge.serverStart(port, sharedId);
  if (!r.ok) { toast(r.error, 'err'); return; }
  state.server = r.status;
  renderShareCard();
  renderList();
}

/* ---------------- 事件绑定 ---------------- */
function bind() {
  $('#newBtn').onclick = () => openEditor(null);
  $('#emptyNewBtn').onclick = () => openEditor(null);
  $('#backBtn').onclick = () => { state.selected = null; emptyIfNone(); };
  $('#editorBackBtn').onclick = () => { if (state.selected) openDetail(state.selected); else emptyIfNone(); };
  $('#saveBtn').onclick = saveEditor;
  $('#editBtn').onclick = () => { const q = state.questionnaires.find(x => x.id === state.selected); if (q) openEditor(q); };
  $('#serverToggle').onclick = toggleServer;

  document.querySelectorAll('.q-adder button').forEach(b => {
    b.onclick = () => addQuestion(b.dataset.type);
  });

  $('#clearBtn').onclick = async () => {
    if (!state.selected) return;
    if (!confirm('确定清空该问卷的全部答卷数据吗？该操作不可恢复。')) return;
    await bridge.clearResponses(state.selected);
    state.responses[state.selected] = [];
    const q = state.questionnaires.find(x => x.id === state.selected);
    openDetail(q.id);
    renderList();
  };
  $('#exportCsvBtn').onclick = async () => {
    if (!state.selected) return;
    const r = await bridge.exportCsv(state.selected);
    if (r.saved) toast('已导出 CSV', 'ok');
  };
  $('#exportJsonBtn').onclick = async () => {
    if (!state.selected) return;
    const r = await bridge.exportJson(state.selected);
    if (r.saved) toast('已导出 JSON', 'ok');
  };

  bridge.onServerStatus(s => {
    state.server = s;
    renderShareCard();
  });
  bridge.onToast(t => toast(t.text, t.type));

  $('#portInput').addEventListener('blur', () => { state.settings.port = Number($('#portInput').value) || 8686; });
}

function emptyIfNone() {
  renderList();
  if (state.questionnaires.length) { openDetail(state.questionnaires[0].id); }
  else showView('empty');
}

/* ---------------- 初始化 ---------------- */
async function init() {
  const data = await bridge.loadAll();
  state.questionnaires = data.questionnaires;
  state.responses = data.responses;
  state.settings = data.settings;
  state.server = data.serverStatus;
  bind();
  renderList();
  renderShareCard();
  if (state.questionnaires.length) {
    state.selected = state.questionnaires[0].id;
    openDetail(state.selected);
  } else {
    showView('empty');
  }
}

init();