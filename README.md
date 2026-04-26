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

## 当前仍需注意

- 断线期间消息目前是“尽量补齐”，不是“绝对全量补齐”
- 如果部署机器无法直连 `web.whatsapp.com`，仍需要设置 `WHATSAPP_PROXY_URL`
- 导出任务当前仍在 API 进程内异步执行，还没有拆成独立 worker

## 目录结构

```text
agent_runner/
cmd/
  api-server/
  session-gateway/
deploy/
  docker/
  migrations/
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

## 启动方式

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
- 查看消息与媒体附件
- 新消息到达时实时刷新
- 右侧对话辅助手动生成回复建议

### 智能回复 Agent

- 创建并编辑 Agent
- 支持大模型 API、Coze、n8n、Webhook 四种接入方式
- 每个 Agent 独立保存 API、模型或 Webhook 配置
- 自动回复开关不放在此页，当前先按手动生成建议执行

### 导出中心

- 按账号分组选择会话
- 支持日期范围
- 默认 `Markdown`
- 每个会话分别创建导出任务
- 每个会话分别下载到本地
- 支持批量下载

## 已验证

- `go test ./internal/... ./cmd/...`
- `cd web && npm run build`
- `docker compose -f deploy/docker/docker-compose.all.yml up -d --build`
- 导出文件下载到本地验证通过
- `/api/live` SSE 实时推送验证通过
- 智能回复 Agent 页面构建与浏览器检查通过

## 下一步建议

1. 继续增强断线期间消息补齐能力
2. 把导出任务拆到独立 worker
3. 根据客户试用反馈，再补充自动回复策略与更细粒度的人工复核流程
