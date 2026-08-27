# 云问卷 Cloud Survey

一套问卷收集与管理工具：本机上开启本地 HTTP 服务端（可配置端口），把问卷以网页形式分享给其他设备填写，回答经端口回传，管理端实时展示统计图表，并可导出 CSV / JSON。

- 单机即可运行，无需部署中心服务器
- 问卷网页是自包含 HTML，任何有浏览器的终端（手机/电脑）打开链接即可作答
- 管理端：创建/编辑问卷、启动/停止服务、查看统计图表、导出数据

## 功能

- 题型支持：单选、多选、填空、评分（1–10 分可调）
- 题目可设为必答、自由增删/排序选项
- HTTP 服务端监听可配置端口（默认 8686，全部网卡），自动列出本机局域网访问地址，带一键复制
- 统计可视化：单选环形图、多选柱状图、评分分布与平均分、文本答案列表
- 答卷明细、清空数据、导出 CSV / JSON
- 数据本地持久化（问卷、答卷、设置均存为 JSON）

## 目录结构

```
cloud-survey/
├── main.js               # Electron 主进程：窗口、IPC
├── preload.js            # 安全的 IPC 桥
├── server.js             # HTTP 服务端（端口传输）与问卷网页生成
├── storage.js            # JSON 数据持久化
├── survey-template.html  # 答题端网页模板
├── renderer/             # 管理端界面（HTML/CSS/JS，图表为纯 Canvas 无第三方依赖）
├── assets/icon.png       # 应用图标
└── package.json          # 依赖与 electron-builder 双平台打包配置
```

## Windows 使用

已打包产物（`dist/`）：

- `云问卷 1.0.0.exe` —— 免安装单文件版，双击即用，可拷到其他电脑直接运行
- `云问卷 Setup 1.0.0.exe` —— 安装包版

数据目录：`%APPDATA%\云问卷\data`（问卷、答卷、设置）

### 手动打包（Windows）

```bash
npm install
npm run dist:win       # 产出单文件版 + 安装包到 dist/
```

## Linux 构建

Linux 的 AppImage / deb 包需要在 **Linux 环境**（或 WSL/Docker）下构建，因为 electron-builder 不支持从 Windows 跨平台打包 Linux。

在有 Node 18+ 的 Linux 机器上：

```bash
npm install
npm run dist:linux      # 产出 .AppImage 与 .deb 到 dist/
```

运行单文件版（开箱即用，无需安装）：

```bash
chmod +x "云问卷-1.0.0-x86_64.AppImage"
./云问卷-1.0.0-x86_64.AppImage
```

数据目录：`~/.config/云问卷/data`

## 工作原理

1. 在管理端新建问卷并“启动服务”，服务监听 `0.0.0.0:<端口>`
2. 把管理端显示的局域网地址 `http://<本机IP>:<端口>/` 分享给受访者
3. 受访者浏览器打开即进入问卷网页，提交后数据经 `POST /submit` 回传到本机
4. 管理端自动更新统计图表与答卷明细，可导出 CSV / JSON

> 提示：端口请使用 1024 以上的端口，避免需要管理员权限；局域网内需保证受访设备与运行端在同一网络。

## HTTP API（程序化对接）

服务端在启动后开放以下接口，便于程序、脚本或第三方系统与问卷对接。所有地址以 `http://<本机IP>:<端口>` 为前缀。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` `/q` `/index` | 返回当前分享问卷的完整答题网页（浏览器直接打开即可作答） |
| POST | `/submit` | 提交一份答卷（JSON） |
| GET | `/health` | 健康检查，返回服务与当前分享问卷信息 |
| OPTIONS | 任意 | CORS 预检（跨域调用时自动处理） |

### 提交答卷 `POST /submit`

请求体为 JSON：

```json
{
  "id": "问卷 ID",
  "answers": {
    "<题目 ID>": "3",          // 单选、评分：选项序号 / 分数（字符串）
    "<题目 ID>": ["1", "3"],   // 多选：选项序号数组
    "<题目 ID>": "文本内容"     // 填空
  }
}
```

- 选项序号从 `1` 开始，对应答题网页上的选项顺序
- 服务端只接收当前问卷中真实存在的题目，其余字段会被丢弃

curl 调用示例（Windows PowerShell 中亦可使用同一命令）：

```bash
curl -X POST http://192.168.1.188:8686/submit \
  -H "Content-Type: application/json" \
  -d '{"id":"qab12cd3","answers":{"cqx0k1":"2","cqx0k2":["1","3"],"cqx0k4":"4"}}'
```

响应：

```json
{ "ok": true, "total": 12 }        // total 为该问卷累计答卷份数
```

失败时返回对应状态码与错误说明（`400` 格式错误、`404` 问卷不存在等）。

> 题目 ID 可在数据目录 `questionnaires.json` 中查看，或在建模后从管理端获得。普通用户也可以完全忽略它——直接用浏览器打开分享链接答题即可。

## 说明

- 采用 MIT 开源协议发布
- 依赖仅 Electron 运行时，无第三方图表/框架库，天然离线可用
- 本工具定位为局域网内问卷收集，请在可信网络中使用；如需公网使用请自行做好安全防护