# WhatsApp 对话台 Smoke Test

## 目标

这份清单只覆盖当前仓库里已经真实落下来的功能，不写还没实现的未来能力。

## 前置条件

- Docker 可用
- Node.js 24+ 和 npm 11+ 可用
- Go 1.22+ 可用

## 步骤

### 1. 启动 PostgreSQL

```bash
docker compose -f deploy/docker/docker-compose.yml up -d
```

验收标准：

- `postgres` 容器启动成功
- 本机 `5432` 端口可访问

### 2. 启动后端 API

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
```

启动：

```bash
go run ./cmd/api-server
```

验收标准：

- `GET /healthz` 返回 `status=ok`
- migration 自动执行成功

### 3. 创建一个账号

```bash
curl -X POST http://127.0.0.1:8080/api/accounts \
  -H "Content-Type: application/json" \
  -d "{\"display_name\":\"售后 1 号机\",\"platform_label\":\"测试环境\"}"
```

验收标准：

- 返回 `201`
- 返回的 `account.id` 是 UUID
- `status` 为 `pending`

### 4. 发起配对

```bash
curl -X POST http://127.0.0.1:8080/api/accounts/{accountId}/pair \
  -H "Content-Type: application/json" \
  -d "{\"method\":\"qr\"}"
```

验收标准：

- 返回 `200`
- `account.session.status` 为 `pairing`
- 返回 `pairing` 字段

### 5. 打开前端

```bash
cd web
npm install
npm run dev
```

验收标准：

- 首页可打开
- 账号接入页可看到账号卡片
- 聊天页不会白屏
- Agent 页可以打开规则编辑表单

### 6. 前端构建

```bash
cd web
npm run lint
npm run build
```

验收标准：

- lint 通过
- build 通过
- `web/dist` 产物生成

### 7. 创建导出任务

```bash
curl -X POST http://127.0.0.1:8080/api/exports \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"{chatId}\",\"format\":\"html\",\"include_media\":true}"
```

验收标准：

- 返回 `201`
- 任务初始状态为 `queued`
- 稍后访问 `GET /api/exports` 能看到任务状态推进到 `completed` 或 `failed`

### 8. 下载导出产物

```bash
curl -L http://127.0.0.1:8080/api/exports/{jobId}/artifact -o export.html
```

验收标准：

- 已完成任务可以下载产物
- 下载后的文件可以正常打开

### 9. 创建 Agent 规则

```bash
curl -X POST http://127.0.0.1:8080/api/agents/rules \
  -H "Content-Type: application/json" \
  -d "{\"account_id\":\"{accountId}\",\"name\":\"售前建议回复\",\"enabled\":false,\"scope_filter\":{\"chat_ids\":[],\"chat_types\":[\"direct\"]},\"trigger_filter\":{\"keywords\":[\"价格\",\"库存\"],\"match_mode\":\"any\",\"ignore_from_me\":true,\"min_message_chars\":0},\"reply_mode\":\"suggest\",\"cooldown_seconds\":300,\"max_auto_replies_per_thread\":1,\"blacklist_filter\":{\"blocked_keywords\":[\"退款\"],\"sensitive_topics\":[\"支付\"]},\"prompt_template\":\"请根据上下文生成礼貌、准确的建议回复。\"}"
```

验收标准：

- 返回 `201`
- 返回 `rule.id`
- 访问 `GET /api/agents/rules` 能看到刚创建的规则

### 10. 启用和停用 Agent 规则

```bash
curl -X POST http://127.0.0.1:8080/api/agents/rules/{ruleId}/enable
curl -X POST http://127.0.0.1:8080/api/agents/rules/{ruleId}/disable
```

验收标准：

- 两次请求都返回 `200`
- 规则状态在启用和停用之间切换

### 11. 查看 Agent 运行记录

```bash
curl http://127.0.0.1:8080/api/agent-runs
```

验收标准：

- 返回结构中包含 `runs`、`total`、`limit`、`offset`
- 当前即便还没有真实运行记录，也应该能稳定返回空数组，而不是报错

## 当前已知限制

- `session-gateway` 还没接真实 `whatsmeow` runtime
- 配对返回的是占位演示数据，不是真实二维码
- 聊天页查询和导出依赖数据库中已经有聊天和消息数据
- Agent 页当前只完成规则管理和运行记录查看，还没接真实 `agent_runner`
