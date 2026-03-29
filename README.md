# WhatsApp 平台工具

这是一个基于 `whatsmeow` 的 WhatsApp 工作台仓库，当前先聚焦三件事：

- 接入多个 WhatsApp 账号
- 查看聊天与媒体
- 导出聊天记录到本地

当前客户界面只保留：

- `账号接入`
- `对话查看`
- `导出中心`

`Agent` 相关后端仍保留在仓库里，但前端入口已隐藏，不作为当前客户交付范围。

## 当前已完成

- Go API、配置加载、结构化日志、PostgreSQL migration
- 真实 `whatsmeow` 会话连接器
- 账号创建、配对、状态查询、退出登录、删除账号
- 实时消息入库
- 聊天列表与消息历史查询
- 导出任务创建、状态轮询、产物下载
- 审计接口与系统健康接口
- Docker 一键启动脚本

最近补过的关键点：

- 账号列表接口增加超时回退，避免会话状态卡住把页面拖白
- 首页总览入口已移除，默认直接进入账号页
- 账号列表改成固定尺寸卡片，多账号时内部滚动
- 对话页重新排版，更适合大量会话浏览
- 导出页改成按账号分组勾选会话
- 导出任务按会话分别创建，每个会话单独出一个文件
- 导出文件下载改成真正保存到本地
- 重连后会尽量补拉断线期间漏掉的一段历史

## 当前仍要注意

- 断线期间消息现在是“尽量补齐”，不是“绝对全量补齐”
- 如果部署机器无法直连 `web.whatsapp.com`，仍然需要 `WHATSAPP_PROXY_URL`
- 导出任务目前还是 API 进程内异步执行，不是独立 worker

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
scripts/
web/
  src/
```

## 主要接口

基础：

- `GET /`
- `GET /healthz`
- `GET /api/system/health`

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

审计：

- `GET /api/audit`

## 环境变量

根目录放 `.env`，可以从 `.env.example` 复制。

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

### 方式一：Docker 一键启动

国内机器推荐直接双击：

- `scripts/docker-up.bat`

它默认走 `daocloud` 镜像加速。

停止：

- `scripts/docker-down.bat`

海外机器或能稳定直连 Docker Hub 的环境，可以用：

- `scripts/docker-up-overseas.bat`

启动完成后：

- Web: `http://127.0.0.1:5173/`
- API: `http://127.0.0.1:8080/healthz`
- Agent Runner: `http://127.0.0.1:8090/healthz`

### 方式二：本机多进程开发

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
- 按关键词搜索
- 查看消息与媒体附件

### 导出中心

- 按账号分组选择会话
- 支持日期范围
- 默认 `Markdown`
- 每个会话分别创建导出任务
- 每个会话分别下载文件到本地

## 已验证

- `go test ./internal/... ./cmd/...`
- `cd web && npm run build`
- `docker compose -f deploy/docker/docker-compose.all.yml up -d --build`
- 导出文件下载到本地验证通过

## 下一步建议

建议继续按这个顺序推进：

1. 继续增强断线期间消息补齐能力
2. 把导出任务拆到独立 worker
3. 视客户需求再决定是否恢复 Agent 客户入口
