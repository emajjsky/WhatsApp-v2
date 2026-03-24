# WhatsApp 对话台

这是一个围绕 `whatsmeow` 搭起来的 WhatsApp 运维/客服工作台，目标很直接：

- 接入多个 WhatsApp 账号
- 实时归档聊天和媒体
- 在网页里查看聊天、导出记录
- 用 Agent 规则生成回复草稿
- 支持人工一键发送，或在明确开启后自动发送

当前这仓库已经不是演示壳子了，主流程已经能跑通。

## 当前已经落地

- Go API、配置加载、结构化日志、PostgreSQL migration。
- 真实 `whatsmeow` 会话连接器：
  - 二维码配对
  - 配对码模式
  - 会话恢复
  - 设备绑定持久化
  - 实时事件回调
- 多账号接入与管理：
  - 创建账号
  - 查看状态
  - 发起配对
  - 退出登录
  - 删除账号
- live ingest：
  - 实时消息进入归档链路
  - 聊天、消息、媒体元数据写库
  - 媒体会尝试下载并落到 `data/media/`
- 聊天查询：
  - 聊天列表
  - 消息历史分页
  - Web 端聊天查看
- 导出：
  - 创建导出任务
  - 查询任务状态
  - 下载导出产物
- Agent 主链路：
  - 创建 / 更新 / 启停 / 删除规则
  - 新消息触发规则匹配
  - 调用 `agent_runner` 生成草稿
  - 聊天页显示最新待复核草稿
  - 人工一键发送
  - 可选自动发送
- `agent_runner`：
  - `mock`
  - `static`
  - `openai_compatible`
- 审计与健康：
  - `GET /api/audit`
  - `GET /api/system/health`
- Docker 一键拉起：
  - Postgres
  - Go API
  - `agent_runner`
  - Web

## 还没补完的地方

- 这台机器如果直连 `web.whatsapp.com` 不通，真实配对仍然依赖 `WHATSAPP_PROXY_URL`。
- 媒体归档已经能跑，但消息类型和媒体处理还不是“全协议全覆盖”。
- 审计页、系统健康页还没有单独做成 Web 页面，目前主要靠 API 和首页摘要。
- 导出任务当前还是 API 进程内异步执行，不是独立 worker 进程。

## 目录结构

```text
agent_runner/
cmd/
  api-server/
  session-gateway/
deploy/
  docker/
  migrations/
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
scripts/
web/
  src/
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
- `DELETE /api/accounts/{accountId}`

### 聊天查询

- `GET /api/chats`
  - 支持 `account_id`
  - 支持 `query`
  - 支持 `chat_type`
  - 支持 `limit`
  - 支持 `offset`
- `GET /api/chats/{chatId}/messages`
  - 支持 `limit`
  - 支持 `before`（RFC3339）

### 导出

- `GET /api/exports`
- `POST /api/exports`
- `GET /api/exports/{jobId}`
- `GET /api/exports/{jobId}/artifact`

### Agent 规则与运行

- `GET /api/agents/rules`
- `GET /api/agents/rules/{ruleId}`
- `POST /api/agents/rules`
- `POST /api/agents/rules/{ruleId}/enable`
- `POST /api/agents/rules/{ruleId}/disable`
- `DELETE /api/agents/rules/{ruleId}`
- `GET /api/agent-runs`
  - 支持 `account_id`
  - 支持 `rule_id`
  - 支持 `chat_id`
  - 支持 `status`
  - 支持 `limit`
  - 支持 `offset`
- `POST /api/agent-runs/{runId}/send`

### 审计

- `GET /api/audit`

### agent_runner

- `GET /healthz`
- `GET /v1/providers`
- `POST /v1/runs`

## 环境变量

根目录放 `.env`，可参考 `.env.example`。

最少需要你自己填的通常是：

```env
OPENAI_COMPAT_BASE_URL=https://api.siliconflow.cn/v1
OPENAI_COMPAT_API_KEY=你的key
OPENAI_COMPAT_MODEL=deepseek-ai/DeepSeek-V3.2
```

几个关键开关：

```env
AGENT_RUNNER_DEFAULT_PROVIDER=openai_compatible
AGENT_AUTO_SEND_ENABLED=false
WHATSAPP_PROXY_URL=
```

说明：

- `AGENT_AUTO_SEND_ENABLED=false`
  代表即使某条规则是 `auto_send`，系统也只会出草稿，不会真发。
- 想真正自动发，必须同时满足：
  - 全局 `AGENT_AUTO_SEND_ENABLED=true`
  - 规则本身 `reply_mode=auto_send`
  - 规则已经启用

## 启动方式

### 方式一：Docker 一键启动（推荐）

```powershell
cd "path\\to\\repo"
.\scripts\docker-up.ps1 -Mirror daocloud
```

等价命令：

```powershell
cd "path\\to\\repo"
$env:DOCKER_IMAGE_PREFIX='docker.m.daocloud.io/library/'
docker compose -f deploy/docker/docker-compose.all.yml up -d --build
```

启动后：

- Web：`http://127.0.0.1:5173/`
- Go API：`http://127.0.0.1:8080/healthz`
- `agent_runner`：`http://127.0.0.1:8090/healthz`

停止：

```powershell
cd "path\\to\\repo"
.\scripts\docker-down.ps1
```

注意：

- 如果容器里的 API 需要走宿主机代理，`WHATSAPP_PROXY_URL` 建议写成：
  - `http://host.docker.internal:7899`
  - 或你自己的本机代理端口
- 如果你本机已经手动跑了 `web / api / agent_runner`，先停掉，不然会跟 Docker 端口冲突。

### 方式二：本机多进程开发

如果你不想用 Docker 跑全套，但又懒得每次自己开 4 个终端：

```powershell
cd "path\\to\\repo"
.\scripts\dev.ps1
```

它会自动拉起：

- 数据库
- `agent_runner`
- Go API
- Web 开发服务器

你也可以通过参数跳过某一项，例如：

```powershell
.\scripts\dev.ps1 -NoDB
```

## 当前推荐验收点

### 账号与连接

- 能创建账号卡片。
- 能发起二维码配对或配对码配对。
- 在网络可达时，扫码后状态能变成 `connected`。
- 能删除不再需要的账号。

### 聊天与归档

- 新消息能进入聊天页。
- 消息历史能分页查看。
- 媒体消息能看到下载结果或附件链接。

### Agent

- 能创建规则。
- 能启停规则。
- 能删除规则。
- 新消息命中规则后，聊天页会出现待复核草稿。
- 点“一键发送”后，消息会写回聊天记录。
- 当 `AGENT_AUTO_SEND_ENABLED=true` 且规则为自动发送时，可直接自动发出。

### 导出

- 能创建导出任务。
- 任务能进入 `completed`。
- 可以下载产物。

## 已验证

- `go test ./...`
- `python -m compileall agent_runner`
- `cd web && npm run build`
- `docker compose -f deploy/docker/docker-compose.all.yml build`
- 浏览器验证：
  - 账号页正常渲染
  - Agent 页正常渲染
  - 删除按钮已出现

## 当前建议

如果接下来继续往前推，优先级建议是：

1. 把审计页和系统健康页做成独立页面。
2. 补更多消息类型和更稳的媒体处理。
3. 视需要把导出任务迁到独立 worker。
4. 继续打磨规则命中策略和发送风控。
