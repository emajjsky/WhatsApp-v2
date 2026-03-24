# WhatsApp 对话台

这是一个围绕 `whatsmeow` 设计的 WhatsApp 平台工具仓库，目标是把账号接入、聊天归档、聊天查看、导出、Agent 规则和运行观测放进同一个操作台里。

当前仓库已经不是空壳，后端、前端、真实 `whatsmeow` 会话接线、导出、审计和系统健康都已经接起来了。

## 当前已经落地

- Go API 基础骨架、配置加载、结构化日志、PostgreSQL migration。
- 账号接入 API：创建账号、查看状态、发起配对、退出登录。
- 真实 `whatsmeow` 会话连接器：支持真实 QR 配对、配对码模式、会话恢复、设备绑定持久化和消息事件回调。
- live ingest：会话事件会进入 `ingest`，自动写入聊天、消息、媒体元数据。
- 聊天查询 API：聊天列表、消息历史分页。
- 导出 API：创建导出任务、查看任务状态、下载导出产物。
- Agent 规则 API：创建规则、更新规则、启停规则、查看运行记录。
- Python `agent_runner`：可独立启动，支持 mock/static provider、策略拦截、草稿生成和 dispatch-ready 判定。
- 审计 API：查询关键操作留痕。
- 系统健康 API：聚合数据库、会话、导出、Agent Runner、审计状态。
- React 控制台页面：
  - 首页总览
  - 账号接入
  - 对话查看
  - 导出中心
  - Agent 规则

## 当前还没落完

- 这台机器当前直连 `web.whatsapp.com` 会超时，所以真实配对还需要网络放行，或者配置 `WHATSAPP_PROXY_URL`。
- 当前消息归档链已经支持真实会话事件，但还没补媒体下载和更完整的消息类型归档。
- Agent 规则还没有打通“消息触发 -> agent_runner -> 自动发送/人工复核”这条完整执行链。
- 审计和系统健康目前已有后端接口，但还没做独立页面。

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
  accounts/
  audit/
  agents/
  chats/
  config/
  exports/
  health/
  httpx/
  ingest/
  platform/
  sessions/
  storage/
web/
  src/
refer/
```

## 已实现 API

### 基础状态

- `GET /`
- `GET /healthz`
- `GET /api/system/health`

### 账号管理

- `GET /api/accounts`
- `POST /api/accounts`
- `GET /api/accounts/{accountId}/status`
- `POST /api/accounts/{accountId}/pair`
- `POST /api/accounts/{accountId}/logout`

### 聊天查询

- `GET /api/chats`
  - 支持 `account_id`
  - 支持 `query`
  - 支持 `chat_type`
  - 支持 `limit`
  - 支持 `offset`
- `GET /api/chats/{chatId}/messages`
  - 支持 `limit`
  - 支持 `before`，格式为 RFC3339

### 导出

- `GET /api/exports`
- `POST /api/exports`
- `GET /api/exports/{jobId}`
- `GET /api/exports/{jobId}/artifact`

### Agent 规则

- `GET /api/agents/rules`
- `GET /api/agents/rules/{ruleId}`
- `POST /api/agents/rules`
- `POST /api/agents/rules/{ruleId}/enable`
- `POST /api/agents/rules/{ruleId}/disable`
- `GET /api/agent-runs`

### 审计

- `GET /api/audit`

### Agent Runner

- `GET /healthz` on `agent_runner`
- `GET /v1/providers`
- `POST /v1/runs`

## 本地启动

### 1. 启动 PostgreSQL

```bash
docker compose -f deploy/docker/docker-compose.yml up -d
```

### 2. 启动后端 API

前提：

- Go 1.25+，或者直接使用仓库里的 `F:/WhatsApp/whatsapp/.tools/go/bin/go.exe`
- PostgreSQL 可访问

示例环境变量：

```bash
APP_NAME=whatsapp-agent-platform
APP_ENV=development
HTTP_HOST=0.0.0.0
HTTP_PORT=8080
DB_DRIVER=postgres
DB_DSN=postgres://postgres:postgres@127.0.0.1:5432/whatsapp_agent_platform?sslmode=disable
DB_AUTO_MIGRATE=true
DB_MIGRATIONS_DIR=deploy/migrations
LOG_LEVEL=debug
LOG_FORMAT=text
AGENT_RUNNER_BASE_URL=http://127.0.0.1:8090
WHATSAPP_PROXY_URL=
```

启动命令：

```bash
go run ./cmd/api-server
```

### 3. 启动 Agent Runner

```bash
python -m agent_runner.app
```

可选环境变量：

```bash
AGENT_RUNNER_HOST=127.0.0.1
AGENT_RUNNER_PORT=8090
AGENT_RUNNER_DEFAULT_PROVIDER=mock
```

### 4. 启动前端

```bash
cd web
npm install
npm run dev
```

前端开发服务器会把 `/api` 和 `/healthz` 代理到 `http://127.0.0.1:8080`。

如果你的网络直连不到 WhatsApp，可以给后端加：

```bash
WHATSAPP_PROXY_URL=http://your-proxy:port
```

## 当前推荐验收点

### 页面层

- 首页是否能看见系统健康和核心计数。
- 账号页能否创建账号并看到状态卡片。
- 发起配对后，页面能否自动轮询状态，并显示二维码或配对码。
- 在网络可达的环境下，扫码后账号状态是否会自动从 `pairing` 变为 `connected`。
- 在真实会话进来后，聊天页能否看到新消息。
- 导出页能否创建任务并下载产物。
- Agent 页能否完成：
  - 新建规则
  - 修改规则
  - 启停规则
  - 查看运行记录

### API 层

- `GET /api/system/health` 返回数据库、会话、导出、Agent Runner、审计摘要。
- `POST /api/accounts/{accountId}/pair` 会发起真实 `whatsmeow` 连接尝试；若网络受限，应能在 `last_error` 里看到明确失败原因。
- `POST /api/exports` 后任务会推进到 `completed`。
- `GET /api/audit` 能看到账号创建、发起配对、创建导出等操作留痕。
- `POST http://127.0.0.1:8090/v1/runs` 能返回 `ready_for_review`、`dispatch_ready` 或 `blocked`。

### 已实际执行的本地验证

- `go test ./...`
- `python -m compileall agent_runner`
- `cd web && npm run lint`
- `cd web && npm run build`
- 本地 smoke：
  - 启动 PostgreSQL
  - 启动 `agent_runner`
- 启动 API
- 创建账号
- 发起真实配对尝试
- 创建导出任务
- 查询审计和系统健康

## 当前环境说明

这台开发机已经验证过以下能力：

- Docker 可用
- 本地 Go 工具链可用
- Python 3.12 可用
- 前端 lint / build 可用

也就是说，这个仓库当前可以在本机完成真实编译、构建和基础 smoke，不再是只能靠静态阅读的状态。

## 参考仓库

`refer/` 目录下已经放了参考项目，当前设计和实现主要吸收了这些方向：

- `refer/whatsmeow`
  - 真实协议接入、会话存储、事件顺序
- `refer/wppconnect`
  - 管理后台接口拆法和账号状态查询风格
- `refer/WhatsApp-Chat-Exporter`
  - 导出格式拆分思路

## 下一步

- 把真实 WhatsApp live event 接到 ingest。
- 把 Agent 规则和 `agent_runner` 真正串到自动触发和发送链路。
- 补独立的审计页和系统健康页。
