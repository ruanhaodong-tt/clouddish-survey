const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Storage = require('./storage');
const SurveyServer = require('./server');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-test-'));
const storage = new Storage(dir);

const q = storage.createQuestionnaire({
  title: '冒烟测试问卷',
  description: '本地服务端收发测试',
  questions: [
    { type: 'single', title: '性别', required: true, options: ['男', '女'] },
    { type: 'multiple', title: '兴趣', options: ['篮球', '足球', '电竞'] },
    { type: 'text', title: '建议', required: false },
    { type: 'rating', title: '满意', required: true, ratingMax: 5 }
  ]
});

const server = new SurveyServer(storage, { adminToken: 'test-token' });

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: 8899, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'] || '', body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  try {
    // webhook 接收端
    let received = null;
    const hook = http.createServer((hreq, hres) => {
      let b = '';
      hreq.on('data', c => b += c);
      hreq.on('end', () => {
        received = JSON.parse(b);
        hres.writeHead(200, { 'Content-Type': 'text/plain' });
        hres.end('ok');
      });
    });
    await new Promise(r => hook.listen(8898, '127.0.0.1', r));

    // 配置 webhook：全选字段 + 自定义标记
    storage.setWebhook({
      enabled: true,
      url: 'http://127.0.0.1:8898/hook',
      fields: ['survey', 'answers', 'stats', 'meta'],
      tags: { source: 'smoke-test' }
    });

    await server.start(8899, q.id);
    console.log('[1] server started, running =', server.isRunning());

    // GET page
    const page = await req('GET', '/');
    console.log('[2] GET / ->', page.status, page.contentType, 'len=', page.body.length);
    if (page.body.indexOf('冒烟测试问卷') < 0) throw new Error('page title missing');
    if (page.body.indexOf(q.id) < 0) throw new Error('qid missing in page');

    // POST answers (use real generated question ids)
    const id1 = q.questions[0].id, id2 = q.questions[1].id, id3 = q.questions[2].id, id4 = q.questions[3].id;
    const a1 = {};
    a1[id1] = '1'; a1[id2] = ['1', '3']; a1[id4] = '4';
    const r1 = await req('POST', '/submit', { id: q.id, answers: a1 });
    console.log('[3] POST submit ->', r1.status, r1.body);
    const a2 = {};
    a2[id1] = '2'; a2[id2] = '2'; a2[id4] = '2';
    const r2 = await req('POST', '/submit', { id: q.id, answers: a2 });
    console.log('[4] POST submit ->', r2.status, r2.body);

    // broadcast count
    console.log('[5] stored responses =', storage.countResponses(q.id));

    // unknown id
    const r3 = await req('POST', '/submit', { id: 'nope', answers: {} });
    console.log('[6] POST unknown ->', r3.status);
    if (r3.status !== 404) throw new Error('unknown id should 404');

    // bad json
    const r4 = await new Promise((resolve, reject) => {
      const rr = http.request({ host: '127.0.0.1', port: 8899, path: '/submit', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 5 } }, res => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      rr.on('error', reject); rr.write('notjson'); rr.end();
    });
    console.log('[7] POST badjson ->', r4.status, r4.body);
    if (r4.status !== 400) throw new Error('bad json should 400');

    // export data via storage (simulate stat reader)
    const rows = storage.getResponses(q.id);
    console.log('[8] response[0].answers =', JSON.stringify(rows[0].answers));
    console.log('[9] response[1].answers =', JSON.stringify(rows[1].answers));

    // API 查询
    const apiS = await req('GET', '/api/survey');
    const apiSJ = JSON.parse(apiS.body);
    console.log('[10] GET /api/survey ->', apiS.status, 'questions=', apiSJ.survey.questions.length, 'responses=', apiSJ.responses);
    if (!apiSJ.survey || apiSJ.survey.questions.length !== 4) throw new Error('api survey wrong');

    const apiR = await req('GET', '/api/responses');
    const apiRJ = JSON.parse(apiR.body);
    console.log('[11] GET /api/responses ->', apiR.status, 'total=', apiRJ.total);
    if (apiRJ.total !== 2) throw new Error('api responses wrong total');

    const apiSt = await req('GET', '/api/stats');
    const apiStJ = JSON.parse(apiSt.body);
    console.log('[12] GET /api/stats ->', apiSt.status, 'avg=', apiStJ.byQuestion[id4] && apiStJ.byQuestion[id4].average);
    if (apiStJ.byQuestion[id4].average !== 3) throw new Error('api stats average wrong (expect 3)');

    // webhook 推送（第三次提交触发）
    const a3 = {};
    a3[id1] = '1'; a3[id4] = '3';
    const r5 = await req('POST', '/submit', { id: q.id, answers: a3 });
    console.log('[13] POST submit(webhook trigger) ->', r5.status, r5.body);
    await new Promise(r => setTimeout(r, 400));

    console.log('[14] webhook payload keys =', received ? Object.keys(received).join(',') : 'NONE');
    if (!received || received.event !== 'response_created') throw new Error('webhook not received');
    if (!received.survey || !received.answers || !received.stats || !received.meta) throw new Error('webhook fields missing');
    if (received.source !== 'smoke-test') throw new Error('custom tag missing');
    if (received.meta.total !== 3) throw new Error('webhook meta.total wrong');
    console.log('[15] webhook answer readable =', JSON.stringify(received.answers[id1]));

    const wh = storage.getWebhook();
    const last = wh.log[wh.log.length - 1];
    console.log('[16] webhook log last =', JSON.stringify(last));
    if (!last || last.ok !== true) throw new Error('webhook log not ok');

    // 管理 API
    const areq = (method, p, body) => new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const r = http.request({
        host: '127.0.0.1', port: 8899, path: p, method,
        headers: Object.assign({ 'Authorization': 'Bearer test-token' }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });

    const noAuth = await req('GET', '/api/admin/surveys');
    console.log('[17] admin no token ->', noAuth.status);
    if (noAuth.status !== 401) throw new Error('admin should 401 without token');

    const c1 = await areq('POST', '/api/admin/survey', { title: '管理页建的问卷', questions: [{ type: 'single', title: '测试', options: ['是', '否'] }] });
    const c1j = JSON.parse(c1.body);
    console.log('[18] admin create ->', c1.status, 'id=', c1j.id);
    if (!c1j.id) throw new Error('create survey failed');

    const l1 = await areq('GET', '/api/admin/surveys');
    const l1j = JSON.parse(l1.body);
    console.log('[19] admin list ->', l1.status, 'count=', l1j.surveys.length);
    if (!l1j.surveys.some(s => s.id === c1j.id)) throw new Error('created survey not in list');

    const up = await areq('POST', '/api/admin/survey', { id: c1j.id, title: '改名问卷', setShared: false, questions: [{ type: 'text', title: '意见' }] });
    console.log('[20] admin update ->', up.status);
    if (up.status !== 200) throw new Error('update failed');

    const sh = await areq('POST', '/api/admin/share', { id: c1j.id });
    console.log('[21] admin share ->', sh.status);
    const h2 = await req('GET', '/health');
    console.log('[22] health after share ->', JSON.parse(h2.body).survey);
    if (JSON.parse(h2.body).survey !== '改名问卷') throw new Error('share not applied');

    const wh1 = await areq('GET', '/api/admin/webhook');
    console.log('[23] admin webhook get ->', wh1.status);
    const wh2 = await areq('POST', '/api/admin/webhook', { enabled: true, url: 'http://127.0.0.1:8898/hook', fields: ['answers', 'meta'], tags: { src: 'admin-test' } });
    console.log('[24] admin webhook set ->', wh2.status, JSON.parse(wh2.body).config.enabled);

    const del = await areq('DELETE', '/api/admin/survey?id=' + c1j.id);
    console.log('[25] admin delete ->', del.status);
    const l2 = await areq('GET', '/api/admin/surveys');
    if (JSON.parse(l2.body).surveys.some(s => s.id === c1j.id)) throw new Error('delete failed');

    const adminPage = await req('GET', '/admin');
    console.log('[26] GET /admin ->', adminPage.status, 'len=', adminPage.body.length);
    if (adminPage.body.indexOf('问卷管理') < 0) throw new Error('admin page missing');

    // 修改管理密码：改后旧 token 失效、新 token 可用
    const pw1 = await areq('POST', '/api/admin/password', { next: 'newpass123' });
    console.log('[27] admin change password ->', pw1.status);
    if (pw1.status !== 200) throw new Error('change password failed');

    const oldTok = await req('GET', '/api/admin/surveys');
    console.log('[28] old token after change ->', oldTok.status);
    if (oldTok.status !== 401) throw new Error('old token should be invalid');

    const areq2 = (method, p) => new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: 8899, path: p, method, headers: { 'Authorization': 'Bearer newpass123' } }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      r.on('error', reject);
      r.end();
    });
    const newTok = await areq2('GET', '/api/admin/surveys');
    console.log('[29] new token works ->', newTok.status);
    if (newTok.status !== 200) throw new Error('new token should work');

    await server.stop();
    hook.close();
    console.log('[30] server stopped, running =', server.isRunning());
    console.log('ALL SMOKE TESTS PASSED');
  } catch (e) {
    console.error('SMOKE TEST FAILED:', e);
    process.exit(1);
  }
})();
