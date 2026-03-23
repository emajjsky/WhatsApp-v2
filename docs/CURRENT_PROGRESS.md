# 当前进度

## 一句话说明

这个仓库现在已经不是空壳了，已经有一版能验收页面和基础流程的 WhatsApp 平台雏形；账号接入、聊天查看、导出中心、Agent 规则管理都已经有真实代码，但还没进入“真实连接 WhatsApp 并自动跑消息”的最后阶段。

## 当前已经完成

### 1. Go 后端基础骨架

- 已有 `cmd/api-server` 和 `cmd/session-gateway` 入口。
- 已接好配置加载、HTTP 服务、结构化日志、PostgreSQL 连接和 migration 自动执行。
- 已补 PostgreSQL 驱动导入，避免后续出现 `unknown driver` 这种低级错误。

### 2. 账号接入 API

当前可用接口：

- `GET /api/accounts`
- `POST /api/accounts`
- `GET /api/accounts/{accountId}/status`
- `POST /api/accounts/{accountId}/pair`
- `POST /api/accounts/{accountId}/logout`

当前状态：

- 账号创建、状态查看、配对动作、退出动作已经有服务层和接口层。
- 现在的配对仍然是占位连接器返回的演示数据，还不是真实 `whatsmeow` 会话。

### 3. 聊天归档和查询基础

当前可用接口：

- `GET /api/chats`
- `GET /api/chats/{chatId}/messages`

已经完成：

- 聊天、联系人、消息、媒体表 migration。
- 消息归档模型、normalize 骨架、查询仓储和分页接口。
- 前端聊天页面可以按账号和关键词筛选，并查看消息时间线。

### 4. 导出中心

当前可用接口：

- `GET /api/exports`
- `POST /api/exports`
- `GET /api/exports/{jobId}`
- `GET /api/exports/{jobId}/artifact`

已经完成：

- 导出任务表 migration。
- JSON / Markdown / HTML 三种导出渲染。
- 导出任务创建、状态查看、结果下载。
- 前端导出页支持发起任务、轮询结果、下载产物。

### 5. Agent 规则管理

当前可用接口：

- `GET /api/agents/rules`
- `GET /api/agents/rules/{ruleId}`
- `POST /api/agents/rules`
- `POST /api/agents/rules/{ruleId}/enable`
- `POST /api/agents/rules/{ruleId}/disable`
- `GET /api/agent-runs`

已经完成：

- `agent_rules` 和 `agent_runs` 两张表 migration。
- Agent 规则模型、仓储、服务、HTTP handler、路由注册。
- 前端 Agent 管理页不再是占位说明，已经支持：
  - 新建规则
  - 修改规则
  - 启用/停用规则
  - 配置触发关键词、范围、冷却时间、敏感主题、提示词
  - 查看最近运行记录
- 自动发送模式做了保守默认：
  - 新建自动发送规则时默认保持停用
  - 切换到自动发送后仍需人工再点一次启用

### 6. 前端控制台

当前已经有这些页面：

- 首页总览
- 账号接入
- 对话查看
- 导出中心
- Agent 规则

设计方向没有乱跑，还是按“新手员工易上手”的原则来做：

- 主操作明显
- 风险动作单独强调
- 少术语
- 状态信息清晰
- 页面结构尽量稳定

### 7. 前端验证结果

在 `web` 目录已经实际跑过：

- `npm run lint`
- `npm run build`

两项都通过。

## 当前还没完成

### 1. 真实 `whatsmeow` 接入

还差这些关键点：

- 真实设备会话初始化
- 真实 QR / pairing code 流程
- 真实连接状态机
- 断线重连
- 真实消息事件回调

### 2. live event -> ingest 闭环

还差：

- `session-gateway` 事件桥接到 ingest
- 收到实时消息后自动写库
- live 更新推给前端

### 3. Python `agent_runner`

现在只完成了规则配置和运行记录的存储、查看能力，还没有真正的 AI 执行服务：

- 还没做 `agent_runner/app.py`
- 还没做 safety policy
- 还没接模型 provider
- 还没接真实建议回复 / 自动回复执行链路

### 4. 审计和系统健康页

还没完成：

- 审计日志服务
- 聚合健康状态接口
- 风险操作留痕页面

## 你现在可以怎么验收

### 页面层

- 看首页结构是否清楚。
- 看账号接入页是否容易理解。
- 看聊天页筛选和时间线是否顺手。
- 看导出页是否能发起任务并看到结果。
- 看 Agent 页是否能让一个新人明白：
  - 先建规则
  - 再看记录
  - 最后才启用自动发送

### 接口层

- 创建账号
- 发起配对
- 查询聊天列表
- 创建导出任务
- 创建 Agent 规则
- 启停 Agent 规则
- 查询 Agent 运行记录

## 你现在还不能验的内容

- 真扫二维码连接 WhatsApp
- 真正同步 WhatsApp 新消息
- 真正让 AI 自动回复客户

不是不做，是还在后续开发里。

## 当前开发阻塞

这台机器现在没有 Go 环境，所以我没法在本机执行：

- `go build ./...`
- `go test ./...`

也就是说，Go 侧目前主要依赖静态检查和代码走查；前端已经做过真实 lint 和 build 验证。

## 下一步优先级

1. 接真实 `whatsmeow` 会话和事件。
2. 把 live message ingest 串通。
3. 落 Python `agent_runner`。
4. 补审计和系统健康。

## 相关文件

- 总说明：`README.md`
- 验收清单：`tests/e2e/platform_smoke_test.md`
- 任务清单：`.spec-workflow/specs/whatsapp-agent-platform/tasks.md`
