# 当前进度

## 一句话说明

仓库已经进入“本地能跑、流程能走”的阶段，不再只是页面壳子或后端草图。

## 当前已经完成

### 1. Go 后端骨架

- `cmd/api-server` 和 `cmd/session-gateway` 入口已存在。
- 配置、HTTP、结构化日志、PostgreSQL migration 已接好。
- `DB_DRIVER=postgres` 会自动兼容到 `pgx`，不会再被驱动名坑死。

### 2. 账号接入

- 已有创建账号、查看状态、发起配对、退出登录接口。
- 当前配对仍然是占位流程，不是真实 `whatsmeow` 登录。
- 占位连接器会在配对后自动模拟连接成功。

### 3. live ingest 闭环

- `sessions` 已经有稳定内部事件模型。
- `event_bridge` 会把 live 消息事件送进 `ingest`。
- 配对成功后会自动灌入演示聊天和消息，聊天页、导出页能直接消费这批数据。

### 4. 聊天查询和导出

- 聊天列表、消息历史分页接口已完成。
- 导出任务创建、状态推进、产物下载已完成。
- 本地 smoke 已确认导出任务可以走到 `completed`。

### 5. Agent 规则和 Runner

- Agent 规则、运行记录仓储和管理 API 已完成。
- 独立 `agent_runner` 服务已完成：
  - `GET /healthz`
  - `GET /v1/providers`
  - `POST /v1/runs`
- 已内置 `mock` / `static` provider。
- 已有策略层，能返回：
  - `ready_for_review`
  - `dispatch_ready`
  - `blocked`

### 6. 审计和系统健康

- 已有 `audit_logs` migration。
- 关键动作会写审计：
  - 创建账号
  - 发起配对
  - 退出登录
  - 创建导出任务
  - Agent 规则保存 / 启停
- 已有 `GET /api/audit`。
- 已有 `GET /api/system/health`，会汇总：
  - 数据库
  - 会话状态
  - 导出任务
  - Agent Runner
  - 审计记录

### 7. 前端

- 首页总览已改成展示系统健康和关键计数。
- 账号、聊天、导出、Agent 页面都能正常打开。
- 前端实际验证已通过：
  - `npm run lint`
  - `npm run build`

### 8. 本地真实验证

这轮已经实际跑过：

- `go test ./...`
- `python -m compileall agent_runner`
- `docker compose up -d`
- API smoke：
  - 创建账号
  - 发起配对
  - 自动生成演示消息
  - 查询聊天
  - 创建导出
  - 查询审计
  - 查询系统健康

## 当前还没完成

### 1. 真实 `whatsmeow` 接入

- 真实设备会话初始化
- 真实二维码 / pairing code 登录
- 真实连接状态机
- 真实断线重连
- 真实 WhatsApp 事件回调

### 2. 真实消息驱动 Agent

- 当前 Agent Runner 还没有被真实消息触发
- 还没打通“规则命中 -> 生成草稿 -> 复核 / 自动发送”
- 还没接真实发送链路

### 3. 独立审计 / 健康页面

- 目前首页已经能看到健康摘要
- 但还没有单独的审计页和系统健康页

## 当前你可以直接验什么

- 配对后是否自动出现演示聊天
- 聊天页是否能看到 2 条演示消息
- 导出任务是否能完成
- 首页是否能看到 Agent Runner 健康
- 审计接口是否能看到关键操作记录
- Agent Runner 独立接口是否能返回草稿或拦截结果

## 下一步优先级

1. 接真实 `whatsmeow` 会话。
2. 把真实 live message ingest 串通。
3. 把 Agent 规则和 `agent_runner` 串到真实消息触发链路。
4. 补独立的审计 / 系统健康页面。
