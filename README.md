# WhatsApp 平台工具

这是一个基于 `whatsmeow` 的 WhatsApp 本地管理工具，当前交付范围包含四块客户功能：

- 账号接入
- 对话查看
- 智能回复 Agent
- 导出中心

## 当前已完成

- Go API、配置加载、结构化日志、PostgreSQL migration
- 真实 `whatsmeow` 会话连接
- 账号创建、二维码配对、配对码配对、状态查询、退出登录、删除账号
- 实时消息入库
- 会话列表与消息历史查询
- 导出任务创建、状态查询、产物下载到本地
- 智能回复 Agent 配置页，可接入大模型 API、Coze、n8n 或通用 Webhook
- 对话右侧辅助区支持手动生成回复建议、写回输入框、发送草稿
- Docker 一键启动
- 前端账号页、对话页、智能回复页、导出页当前版本已可直接使用
- 实时更新已恢复为 SSE 推送，页面不再只靠轮询
- Provider 配置统一由后台维护，模型默认关闭思考输出并兼容较慢 Provider 的流式响应
- Provider 用途在文本模型与 ASR 之间单选；ASR 支持 OpenAI-compatible `/audio/transcriptions` 和 OpenRouter 多模态音频，管理员可配置默认转写 Provider 并上传音频测试
- 会话自定义列表可直接显示在顶部筛选栏，并可通过右键“更改列表”管理会话归属
- 会话消息支持关键词搜索和按日期定位；选择日期后会跳到当天第一条消息并高亮
- 离开对话页再返回时会恢复原账号、原会话及筛选条件，每个账号分别记住最后打开的会话
- 会话右键菜单支持归档、静音、置顶、已读状态、特别关注、自定义列表、备注、清空和删除；消息菜单支持详情、回复、复制、转发、置顶、星标、编辑、选择和两种删除方式
- 输入区提供 Emoji / GIF / 贴图三栏选择器，Emoji 使用经用户授权从本机 WhatsApp Desktop 2.2635.100.0 提取的彩色字体；GIF 支持选择本地文件发送，贴图支持将自有图片转换为 WebP 后发送。官方安装包不包含可离线复制的贴图库和 GIF 内容源
- “为所有人删除”、表情回应、编辑、星标、联系人名片和投票走 WhatsApp 协议；消息置顶、从我这端删除、清空聊天和删除聊天是本软件本地状态
- 已增加语音消息录制入口：Windows Chromium 录制的 WebM 会在本地转换为 WhatsApp PTT 使用的单声道 48kHz OGG Opus；收到的语音消息使用波形、进度和时长播放器展示，普通音频文件仍按普通音频附件发送。来电会通过 SSE 和桌面通知提示，同一通来电的 `CallOffer` / `CallOfferNotice` 会在两分钟窗口内去重；语音/视频通话仍需在手机或官方 WhatsApp 客户端接听
- 收到的语音消息支持转录：客户端把本地语音安全上传到云端默认 ASR Provider，自动识别任意语种并返回原文，再复用翻译 Agent 翻译成中文；原文和译文分开展示并在本机缓存，转录失败不影响语音播放
- 对话页只展示已连接或正在重连的账号；发送或上传收到 WhatsApp `401/not-authorized` 时，会清除本地设备绑定和 whatsmeow 凭据，把账号切为“已退出”，并要求重新扫码
- 引用回复会携带原消息 ID、发送者和按消息类型构造的 WhatsApp 引用内容；前端显示引用块，支持点击跳回原消息，长引用不会溢出气泡
- 联系人名片提供真实“发消息”入口，可在当前账号下创建或打开对应 WhatsApp 单聊；左侧会话和联系人详情统一显示昵称、国际号码和已同步头像
- 本地 IP 代理池采用四列卡片列表，新增和编辑代理统一在弹窗中完成
- Windows 客户端当前发布版本为 `0.1.65`

- Agent 配置将系统输出规则与角色/功能要求分开管理，三类 Agent 调用时自动合并生效；规则默认收起，用户只需填写角色和功能要求。

## 当前仍需注意

- 断线期间消息目前是“尽量补齐”，不是“绝对全量补齐”
- 如果部署机器无法直连 `web.whatsapp.com`，仍需要设置 `WHATSAPP_PROXY_URL`
- 导出任务当前仍在 API 进程内异步执行，还没有拆成独立 worker
- Electron 桌面端已经支持本地代理池和账号级代理绑定；云端不保存代理凭据
- 国内网络可使用“Clash 普通代理 -> 账号独立代理”的链式路径，境外无 Clash 时可使用自动判断或直连代理
- Windows 安装包内置固定版本的 FFmpeg LGPL v3 shared 构建用于语音转码；构建时校验下载文件、版本、许可证、动态链接方式和 Opus 编码能力，许可证、构建参数及源码地址随安装包分发

生产上线前请先阅读：

- [生产就绪审查](docs/production-readiness.md)
- [WhatsApp 一账号一固定 IP 方案](docs/account-level-proxy-design.md)

## 目录结构

```text
agent_runner/
cmd/
  api-server/
  session-gateway/
deploy/
  docker/
  migrations/
desktop/
  src/
  scripts/
  build/
docs/
internal/
scripts/
web/
  src/
```

## 主要接口

基础：

- `GET /`
- `GET /healthz`
- `GET /api/system/health`
- `GET /api/live`

账号：

- `GET /api/accounts`
- `POST /api/accounts`
- `GET /api/accounts/{accountId}/status`
- `POST /api/accounts/{accountId}/pair`
- `POST /api/accounts/{accountId}/logout`
- `DELETE /api/accounts/{accountId}`

聊天：

- `GET /api/chats`
- `POST /api/chats`（根据国际号码创建或打开单聊）
- `GET /api/chats/{chatId}/messages`

导出：

- `GET /api/exports`
- `POST /api/exports`
- `GET /api/exports/{jobId}`
- `GET /api/exports/{jobId}/artifact`

智能回复：

- `GET /api/agents/rules`
- `POST /api/agents/rules`
- `DELETE /api/agents/rules/{ruleId}`
- `POST /api/agent-runs/generate`
- `POST /api/agent-runs/{runId}/send`

审计：

- `GET /api/audit`

## 环境变量

项目根目录需要 `.env`，首次部署请从 `.env.example` 复制：

```bash
cp .env.example .env
```

常用项：

```env
APP_NAME=whatsapp-agent-platform
APP_ENV=development
HTTP_HOST=127.0.0.1
HTTP_PORT=8080
DB_DRIVER=postgres
DB_DSN=postgres://postgres:postgres@127.0.0.1:5432/whatsapp_agent_platform?sslmode=disable
DB_AUTO_MIGRATE=true
DB_MIGRATIONS_DIR=deploy/migrations
LOG_LEVEL=debug
LOG_FORMAT=text
WHATSAPP_PROXY_URL=
```

### 登录与管理员

服务器/SaaS 模式已经内置注册登录和管理员后台：

- 第一次启动会自动创建管理员账号。
- 默认管理员：`admin@example.com`
- 默认密码：`admin123456`
- 生产环境必须在 `.env` 里修改默认密码。

推荐配置：

```env
AUTH_COOKIE_NAME=wa_session
AUTH_SESSION_TTL=168h
AUTH_REGISTRATION_ENABLED=false
AUTH_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
AUTH_BOOTSTRAP_ADMIN_PASSWORD=change-this-password
AUTH_BOOTSTRAP_ADMIN_NAME=Administrator
AUTH_SECURE_COOKIE=false
```

如果使用 HTTPS 部署，把 `AUTH_SECURE_COOKIE=true`。公开注册默认关闭，管理员可以在“系统管理”里创建普通用户、禁用用户、重置密码，并配置全局回复 Agent / 翻译 Agent。

## 启动方式

服务器部署和后续更新请看：[服务器部署与更新](docs/server-deploy.md)

### Windows

前置要求：

- 已安装并启动 Docker Desktop
- 项目根目录已有 `.env`

国内网络推荐：

- `scripts/docker-up.bat`

海外网络或可稳定直连 Docker Hub 的环境：

- `scripts/docker-up-overseas.bat`

停止服务：

- `scripts/docker-down.bat`

说明：

- 当前 `.bat` 只是 Windows 入口，底层仍依赖 `scripts/docker-up.ps1` 和 `scripts/docker-down.ps1`
- 这两个 `.ps1` 现在还不能删除，删了 Windows 一键启动就会失效
- `bat` 已补充失败提示，不会再一闪而过看不到错误

### macOS / Linux

前置要求：

- macOS：已安装并启动 Docker Desktop
- Linux：已安装 Docker Engine + Docker Compose，或者使用 Docker Desktop
- 项目根目录已有 `.env`

国内网络推荐：

```bash
cp .env.example .env
sh scripts/docker-up.sh
```

海外网络：

```bash
cp .env.example .env
sh scripts/docker-up-overseas.sh
```

停止服务：

```bash
sh scripts/docker-down.sh
```

## 启动完成后

- Web: `http://127.0.0.1:5173/`
- API: `http://127.0.0.1:8080/healthz`
- Agent Runner: `http://127.0.0.1:8090/healthz`

## 本地开发

如需本机多进程调试，可在 Windows PowerShell 中执行：

```powershell
cd "path\to\repo"
.\scripts\dev.ps1
```

## 当前客户界面

### 账号接入

- 创建账号
- 二维码配对 / 配对码配对
- 查看当前状态
- 退出登录 / 删除账号

### 对话查看

- 按账号筛选
- 按聊天类型筛选
- 按关键字搜索
- 按日期跳转到当天第一条消息
- 查看消息与媒体附件
- 发送标准 Emoji、表情回应、联系人名片、原生投票和自定义贴图
- 消息详情、回复、复制、转发、星标、编辑、选择及删除
- 新消息到达时实时刷新
- 右侧对话辅助手动生成回复建议

### 智能回复 Agent

- 创建并编辑 Agent
- Provider 配置统一保存 Base URL 和 API Key，并可自动检测可用模型
- Provider 只能选择文本模型或 ASR 一种用途；OpenRouter ASR 会自动配置接口并提供 Gemini Flash Lite / Flash 模型选择，用户只需填写 API Key；ASR 不使用智能体提示词，语种默认自动识别
- 智能体只选择 Provider 和该 Provider 下的模型，默认带入 Provider 的默认模型
- API Key 只保存在云端，不下发给桌面客户端
- 自动回复开关不放在此页，当前先按手动生成建议执行

### 导出中心

- 按账号分组选择会话
- 支持日期范围
- 默认 `Markdown`
- 每个会话分别创建导出任务
- 每个会话分别下载到本地
- 支持批量下载

## 已验证

- `go test ./...`
- `go test ./internal/proxychain ./internal/proxies ./internal/platform`
- `cd web && npm run build`
- `docker compose -f deploy/docker/docker-compose.all.yml up -d --build`
- 导出文件下载到本地验证通过
- `/api/live` SSE 实时推送验证通过
- 智能回复 Agent 页面构建与浏览器检查通过
- 普通 Clash 入口链式到静态 SOCKS5 代理的双层 TCP 连接验证通过
- HTTP CONNECT 成功后的隧道复用和 SOCKS5 用户名密码握手已修复

## 下一步建议

1. 继续增强断线期间消息补齐能力
2. 把导出任务拆到独立 worker
3. 根据客户试用反馈，再补充自动回复策略与更细粒度的人工复核流程
