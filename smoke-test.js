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

const server = new SurveyServer(storage);

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

    // bad json
    const r4 = await new Promise((resolve, reject) => {
      const rr = http.request({ host: '127.0.0.1', port: 8899, path: '/submit', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 5 } }, res => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      rr.on('error', reject); rr.write('notjson'); rr.end();
    });
    console.log('[7] POST badjson ->', r4.status, r4.body);

    // export data via storage (simulate stat reader)
    const rows = storage.getResponses(q.id);
    console.log('[8] response[0].answers =', JSON.stringify(rows[0].answers));
    console.log('[9] response[1].answers =', JSON.stringify(rows[1].answers));

    await server.stop();
    console.log('[10] server stopped, running =', server.isRunning());
    console.log('ALL SMOKE TESTS PASSED');
  } catch (e) {
    console.error('SMOKE TEST FAILED:', e);
    process.exit(1);
  }
})();