# 交付状态说明

更新日期：2026-03-23

## 项目目标

这个项目的目标是做一个基于 `whatsmeow` 的 WhatsApp 平台工具，最终要覆盖这几块能力：

- 多账号接入和会话管理
- 聊天记录归档与查询
- 聊天导出
- Agent 建议回复和自动回复
- 风险控制、审计和系统健康

## 当前已经完成的内容

### 1. 后端基础骨架

已经完成：

- Go 项目基础结构
- API 入口和应用装配
- 配置加载
- HTTP 服务
- 结构化日志
- PostgreSQL 连接
- migration 自动执行

当前已有入口：

- `cmd/api-server`
- `cmd/session-gateway`

### 2. 账号管理

已经完成：

- 账号表和会话凭据表
- 账号仓储、服务和 HTTP handler
- 账号创建、查看状态、发起配对、退出登录接口

当前可用接口：

- `GET /api/accounts`
- `POST /api/accounts`
- `GET /api/accounts/{accountId}/status`
- `POST /api/accounts/{accountId}/pair`
- `POST /api/accounts/{accountId}/logout`

说明：

- 现在的配对流程还是占位实现，不是真实 `whatsmeow` 登录。

### 3. 聊天记录归档与查询

已经完成：

- 聊天、联系人、消息、媒体表
- 消息归档模型
- 查询仓储
- 聊天列表接口
- 消息历史分页接口

当前可用接口：

- `GET /api/chats`
- `GET /api/chats/{chatId}/messages`

### 4. 导出中心

已经完成：

- 导出任务表
- 导出任务仓储和服务
- JSON / Markdown / HTML 导出渲染
- 导出任务 API
- 导出结果文件落地

当前可用接口：

- `GET /api/exports`
- `POST /api/exports`
- `GET /api/exports/{jobId}`
- `GET /api/exports/{jobId}/artifact`

说明：

- 当前导出是进程内异步任务，不是独立 worker。

### 5. Agent 规则管理

已经完成：

- `agent_rules` 和 `agent_runs` 表
- Agent 规则模型、仓储、服务、HTTP handler
- 规则创建、更新、启停、列表、运行记录查询接口
- 前端 Agent 管理页面

当前可用接口：

- `GET /api/agents/rules`
- `GET /api/agents/rules/{ruleId}`
- `POST /api/agents/rules`
- `POST /api/agents/rules/{ruleId}/enable`
- `POST /api/agents/rules/{ruleId}/disable`
- `GET /api/agent-runs`

说明：

- 自动发送规则已经做了保守默认：新建后默认不直接启用，需要人工再点一次启用。

### 6. 前端控制台

已经完成页面：

- 首页总览
- 账号接入
- 对话查看
- 导出中心
- Agent 规则

前端方向已经固定为“新手员工能看懂、能上手”的工作台风格，不走技术后台那种一坨表格的路子。

### 7. 前端验证

已经实际执行并通过：

- `npm run lint`
- `npm run build`

## 当前还没有完成的内容

### 1. 真实 `whatsmeow` 会话接入

还没完成：

- 真正的设备会话初始化
- 真正的二维码 / pairing code 登录
- 真实连接状态机
- 断线重连
- 协议层事件回调

### 2. 实时消息进入归档链路

还没完成：

- `session-gateway` 事件桥接到 ingest
- 收到实时消息后自动写数据库
- 前端实时刷新

### 3. 真正的 AI 执行服务

还没完成：

- Python `agent_runner`
- safety policy
- LLM provider 适配
- 建议回复生成链路
- 自动回复实际发送链路

### 4. 审计和系统健康

还没完成：

- 审计日志服务
- 系统健康聚合服务
- 风险动作留痕页面

## 当前能验收什么

可以验收：

- 目录结构是否清晰
- 前端页面是否完整
- 页面交互是否顺手
- Agent 规则页面是否能完成规则配置和启停
- 后端 API 设计是否成型
- 导出链路是否完整

当前还不能验收：

- 真实扫描二维码连接 WhatsApp
- 真实同步 WhatsApp 聊天
- 真实 AI 自动回复客户

## 当前主要阻塞

当前机器环境问题：

- 没有安装 Go
- 没有安装 Docker Desktop

这会直接导致：

- 后端跑不起来
- PostgreSQL 起不来
- 页面虽然能构建，但无法连后端接口

## 下一步建议

建议后续按这个优先级继续推进：

1. 安装开发环境并把当前版本先完整跑起来
2. 接真实 `whatsmeow` 会话
3. 打通 live event -> ingest
4. 落地 Python `agent_runner`
5. 补审计和系统健康

## 相关文件

- 总说明：`README.md`
- 当前进度：`docs/CURRENT_PROGRESS.md`
- 本文档：`docs/DELIVERY_STATUS.md`
- 验收清单：`tests/e2e/platform_smoke_test.md`
- 任务清单：`.spec-workflow/specs/whatsapp-agent-platform/tasks.md`
