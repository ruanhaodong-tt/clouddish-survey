// 极简 webhook 接收端示例
// 运行：node examples/webhook-receiver.js
// 启动后监听 3000 端口，把云问卷推送来的答卷实时打印出来
const http = require('http');
const PORT = 3000;

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      console.log('[' + new Date().toLocaleString('zh-CN') + '] 收到答卷推送');
      console.log('  事件:', data.event);
      if (data.meta) console.log('  提交序号:', data.meta.total, '| 来源:', data.meta.from);
      if (data.answers) {
        Object.keys(data.answers).forEach((k) => {
          const a = data.answers[k];
          console.log('  ' + a.title + ':', Array.isArray(a.value) ? a.value.join('、') : a.value);
        });
      }
      if (data.source) console.log('  自定义标记 source:', data.source);
      if (data.stats) console.log('  当前总答卷数:', data.stats.total);
    } catch (e) {
      console.log('无法解析的请求体:', body.slice(0, 200));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(PORT, () => {
  console.log('webhook 接收端已启动: http://127.0.0.1:' + PORT + '/');
  console.log('在云问卷「新答卷推送」面板把接口地址填成 http://127.0.0.1:' + PORT + ' 并启用，提交答卷即可看到推送');
});
