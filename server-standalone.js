#!/usr/bin/env node
// 无界面服务端入口（云服务器部署）
// 零依赖，无需 npm install，纯 Node 运行：
//   node server-standalone.js [端口] [可选问卷JSON文件]
// 环境变量（可选）：
//   SURVEY_DATA_DIR   数据目录，默认 ~/.clouddish-survey-data
//   SURVEY_WEBHOOK_URL      启用新答卷推送的接收地址
//   SURVEY_WEBHOOK_FIELDS   推送内容，逗号分隔：survey,answers,stats,meta
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const Storage = require('./storage');
const SurveyServer = require('./server');

const dataDir = process.env.SURVEY_DATA_DIR || path.join(os.homedir(), '.clouddish-survey-data');
const port = parseInt(process.argv[2], 10) || 8686;
const qFile = process.argv[3];

// admin token：可用 SURVEY_ADMIN_TOKEN 固定；否则随机生成并打印
const adminToken = process.env.SURVEY_ADMIN_TOKEN ||
  ('cs' + crypto.randomBytes(9).toString('hex'));

const storage = new Storage(dataDir);

(async () => {
  // 导入指定问卷 JSON（可选）
  if (qFile && fs.existsSync(qFile)) {
    const raw = JSON.parse(fs.readFileSync(qFile, 'utf8'));
    const q = storage.createQuestionnaire(raw);
    storage.setShared(q.id);
    console.log('已导入问卷:', q.title, '| id=' + q.id);
  }

  // 确保至少有一份共享问卷
  if (!storage.listQuestionnaires().length) {
    const q = storage.createQuestionnaire({
      title: '示例问卷',
      description: '服务端自动创建，请替换为你的问卷',
      questions: [
        { type: 'single', title: '性别', required: true, options: ['男', '女'] },
        { type: 'multiple', title: '兴趣', options: ['篮球', '足球', '电竞'] },
        { type: 'text', title: '建议' },
        { type: 'rating', title: '满意度', ratingMax: 5 }
      ]
    });
    storage.setShared(q.id);
    console.log('已创建示例问卷:', q.title, '| id=' + q.id);
  } else if (!storage.getSettings().sharedId) {
    storage.setShared(storage.listQuestionnaires()[0].id);
  }

  // webhook 推送（可选，通过环境变量配置）
  if (process.env.SURVEY_WEBHOOK_URL) {
    const fields = (process.env.SURVEY_WEBHOOK_FIELDS || 'survey,answers,stats,meta').split(',').map(s => s.trim()).filter(Boolean);
    storage.setWebhook({ enabled: true, url: process.env.SURVEY_WEBHOOK_URL, fields, tags: {} });
    console.log('webhook 推送已启用 ->', process.env.SURVEY_WEBHOOK_URL);
  }

  const server = new SurveyServer(storage, { adminToken });
  try {
    const st = await server.start(port);
    console.log('');
    console.log('问卷服务已启动');
    console.log('  答题页: http://<服务器IP>:' + st.port + '/');
    console.log('  管理页: http://<服务器IP>:' + st.port + '/admin');
    console.log('  admin token: ' + adminToken + (process.env.SURVEY_ADMIN_TOKEN ? '' : '  (随机生成，下次启动会变化)'));
    console.log('  查询接口: /api/survey  /api/responses  /api/stats');
    console.log('  提交接口: POST /submit');
    console.log('  数据目录: ' + dataDir);
    console.log('按 Ctrl+C 停止');
  } catch (e) {
    console.error('启动失败:', e.message);
    process.exit(1);
  }
})();
