# WhatsApp 对话台

这是一个围绕 `whatsmeow` 设计的 WhatsApp 平台工具仓库，目标是把账号接入、聊天归档、聊天查看、导出和 Agent 自动回复放进同一个操作台里。

当前仓库已经有一版可验收的 MVP 雏形，不是纯文档仓库了。

## 当前已经落地

- Go API 基础骨架、配置加载、结构化日志、PostgreSQL migration。
- 账号接入 API：创建账号、查看状态、发起配对、退出登录。
- 聊天查询 API：聊天列表、消息历史分页。
- 导出 API：创建导出任务、查看任务状态、下载导出产物。
- Agent 规则 API：创建规则、更新规则、启停规则、查看运行记录。
- React 控制台页面：
  - 首页总览
  - 账号接入
  - 对话查看
  - 导出中心
  - Agent 规则

## 当前还没落完

- 真实 `whatsmeow` 会话接入目前仍是占位连接器。
- 真实 live message ingest 还没闭环。
- Python `agent_runner` 还没接上。
- 审计日志和系统健康页还没做。

## 目录结构

```text
cmd/
  api-server/
  session-gateway/
deploy/
  docker/
  migrations/
docs/
internal/
  accounts/
  agents/
  chats/
  config/
  exports/
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

## 本地启动

### 1. 启动 PostgreSQL

```bash
docker compose -f deploy/docker/docker-compose.yml up -d
```

### 2. 启动后端

前提：

- Go 1.22+
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
```

启动命令：

```bash
go run ./cmd/api-server
```

### 3. 启动前端

```bash
cd web
npm install
npm run dev
```

前端开发服务器会把 `/api` 和 `/healthz` 代理到 `http://127.0.0.1:8080`。

## 当前推荐验收点

### 页面层

- 首页是否能让新人快速知道下一步该做什么。
- 账号页能否创建账号并看到状态卡片。
- 聊天页能否筛选聊天并查看消息历史。
- 导出页能否创建任务并在完成后下载产物。
- Agent 页能否完成：
  - 新建规则
  - 修改规则
  - 启停规则
  - 查看运行记录

### 前端校验结果

已实际执行：

- `npm run lint`
- `npm run build`

两项都通过。

## 当前环境说明

这台开发机没有 Go 环境，所以目前不能在本机执行：

- `go build ./...`
- `go test ./...`

也就是说，Go 代码目前还没在这台机器上做真实编译验证；前端已经完成真实构建验证。

## 参考仓库

`refer/` 目录下已经放了参考项目，当前设计和实现主要吸收了这些方向：

- `refer/whatsmeow`
  - 真实协议接入、会话存储、事件顺序
- `refer/wppconnect`
  - 管理后台接口拆法和账号状态查询风格
- `refer/WhatsApp-Chat-Exporter`
  - 导出格式拆分思路

## 下一步

- 用真实 `whatsmeow` client 替换占位连接器
- 把 live event 接入 ingest
- 落 Python `agent_runner`
- 补审计和系统健康
