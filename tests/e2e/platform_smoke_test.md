# WhatsApp 对话台 Smoke Test

## 目标

这份清单只覆盖当前仓库里已经真实落下来的功能，不写还没实现的未来能力。

## 前置条件

- Docker 可用
- Node.js 24+ 和 npm 11+ 可用
- Python 3.12+ 可用
- Go 1.25+ 可用，或者直接使用仓库里的 `.tools/go/bin/go.exe`

## 步骤

### 1. 启动 PostgreSQL

```bash
docker compose -f deploy/docker/docker-compose.yml up -d
```

验收标准：

- `postgres` 容器启动成功
- 本机 `5432` 端口可访问

### 2. 启动 Agent Runner

```bash
python -m agent_runner.app
```

验收标准：

- `GET http://127.0.0.1:8090/healthz` 返回 `status=ok`
- `GET http://127.0.0.1:8090/v1/providers` 返回内置 provider 列表

### 3. 启动后端 API

环境变量：

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
```

启动：

```bash
go run ./cmd/api-server
```

验收标准：

- `GET /healthz` 返回 `status=ok`
- `GET /api/system/health` 返回 `status=ok` 或 `degraded`
- migration 自动执行成功

### 4. 创建一个账号

```bash
curl -X POST http://127.0.0.1:8080/api/accounts \
  -H "Content-Type: application/json" \
  -d "{\"display_name\":\"售后 1 号机\",\"platform_label\":\"测试环境\"}"
```

验收标准：

- 返回 `201`
- 返回的 `account.id` 是 UUID
- `status` 为 `pending`

### 5. 发起配对

```bash
curl -X POST http://127.0.0.1:8080/api/accounts/{accountId}/pair \
  -H "Content-Type: application/json" \
  -d "{\"method\":\"qr\"}"
```

验收标准：

- 返回 `200`
- 初始返回 `account.session.status=pairing`
- 等 1 到 2 秒后，再调 `GET /api/accounts` 或 `GET /api/accounts/{accountId}/status`
- 账号状态会自动变为 `connected`

### 6. 确认演示消息进入归档

```bash
curl "http://127.0.0.1:8080/api/chats?limit=10"
curl "http://127.0.0.1:8080/api/chats/{chatId}/messages?limit=10"
```

验收标准：

- 聊天列表至少出现 1 个演示会话
- 演示会话标题可见
- 消息历史至少出现 2 条演示消息

### 7. 打开前端

```bash
cd web
npm install
npm run dev
```

验收标准：

- 首页可打开
- 首页能看到系统状态和组件摘要
- 账号接入页可看到账号卡片
- 聊天页不会白屏
- Agent 页可以打开规则编辑表单

### 8. 前端构建

```bash
cd web
npm run lint
npm run build
```

验收标准：

- lint 通过
- build 通过
- `web/dist` 产物生成

### 9. 创建导出任务

```bash
curl -X POST http://127.0.0.1:8080/api/exports \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"{chatId}\",\"format\":\"html\",\"include_media\":false}"
```

验收标准：

- 返回 `201`
- 任务初始状态为 `queued`
- 稍后访问 `GET /api/exports/{jobId}` 能看到状态推进到 `completed` 或 `failed`

### 10. 下载导出产物

```bash
curl -L http://127.0.0.1:8080/api/exports/{jobId}/artifact -o export.html
```

验收标准：

- 已完成任务可以下载产物
- 下载后的文件可以正常打开

### 11. 创建 Agent 规则

```bash
curl -X POST http://127.0.0.1:8080/api/agents/rules \
  -H "Content-Type: application/json" \
  -d "{\"account_id\":\"{accountId}\",\"name\":\"售前建议回复\",\"enabled\":false,\"scope_filter\":{\"chat_ids\":[],\"chat_types\":[\"direct\"]},\"trigger_filter\":{\"keywords\":[\"价格\",\"库存\"],\"match_mode\":\"any\",\"ignore_from_me\":true,\"min_message_chars\":0},\"reply_mode\":\"suggest\",\"cooldown_seconds\":300,\"max_auto_replies_per_thread\":1,\"blacklist_filter\":{\"blocked_keywords\":[\"退款\"],\"sensitive_topics\":[\"支付\"]},\"prompt_template\":\"请根据上下文生成礼貌、准确的建议回复。\"}"
```

验收标准：

- 返回 `201`
- 返回 `rule.id`
- 访问 `GET /api/agents/rules` 能看到刚创建的规则

### 12. 查看审计

```bash
curl "http://127.0.0.1:8080/api/audit?limit=20"
```

验收标准：

- 返回结构中包含 `entries`、`total`、`limit`、`offset`
- 可以看到账号创建、发起配对、创建导出等关键动作

### 13. 直接调用 Agent Runner

```bash
curl -X POST http://127.0.0.1:8090/v1/runs \
  -H "Content-Type: application/json" \
  -d "{\"account_id\":\"demo-account\",\"chat_id\":\"demo-chat\",\"trigger_message_id\":\"demo-message\",\"rule\":{\"name\":\"发货查询\",\"enabled\":true,\"reply_mode\":\"suggest\",\"cooldown_seconds\":300,\"max_auto_replies_per_thread\":1,\"prompt_template\":\"请根据上下文生成客服回复\",\"blacklist_filter\":{\"blocked_keywords\":[\"赔钱\"],\"sensitive_topics\":[\"退款\"]}},\"message\":{\"text\":\"你好，想问一下订单什么时候发货\"},\"context\":{\"recent_messages\":[{\"role\":\"customer\",\"text\":\"你好\"},{\"role\":\"agent\",\"text\":\"您好，请问有什么可以帮您\"}]},\"provider\":{\"type\":\"mock\"}}"
```

验收标准：

- 返回 `ready_for_review`、`dispatch_ready` 或 `blocked`
- `draft` 不为空
- `policy` 字段存在

## 当前已知限制

- `session-gateway` 还没接真实 `whatsmeow` runtime
- 当前自动进入聊天列表的是占位演示消息，不是真实 WhatsApp 新消息
- Agent Runner 已经存在，但还没被真实规则触发链路调起来
- 还没有独立的审计页和系统健康页
