# 交付状态说明

更新日期：2026-03-23

## 当前交付结论

这版仓库已经达到“本地可运行、可验证、可继续迭代”的状态，核心不是 PPT，也不是只会编译的半成品。

## 已完成交付

### 1. 运行基础

- Go 后端能编译通过。
- PostgreSQL docker-compose 可直接启动。
- 前端可完成 lint 和 production build。
- Python `agent_runner` 可独立启动并返回健康状态。

### 2. 账号与会话

- 账号创建、查看状态、发起配对、退出登录 API 已完成。
- 当前会话仍为占位实现，但已经具备：
  - 配对状态
  - 自动转为 connected
  - 会话状态写回账号状态

### 3. 消息归档

- live 事件桥接已接入 `ingest`。
- 配对后占位连接器会自动灌入演示消息。
- 聊天列表和消息历史会真实出现可查询数据。

### 4. 导出

- 导出任务 API 已完成。
- 导出渲染和产物下载已完成。
- 本地 smoke 已验证导出任务可以走完。

### 5. Agent 规则和 Runner

- Agent 规则管理和运行记录查询已完成。
- `agent_runner` 已提供：
  - provider 抽象
  - mock/static provider
  - 策略校验
  - 草稿生成
  - dispatch-ready 判定

### 6. 审计和系统健康

- 关键变更操作已经落审计。
- `GET /api/audit` 可查询审计记录。
- `GET /api/system/health` 可查看数据库、会话、导出、Agent Runner、审计摘要。

## 仍未交付

### 1. 真实协议接入

- 真实 `whatsmeow` 登录
- 真实会话持久化和恢复
- 真实协议事件监听

### 2. Agent 自动执行主链路

- 规则命中检测
- 消息触发 Agent Runner
- 自动发送 / 人工审批发送
- 发送结果回写运行记录

### 3. 独立管理页面

- 审计页
- 系统健康页

## 已做的真实验证

- `go test ./...`
- `python -m compileall agent_runner`
- `npm run lint`
- `npm run build`
- 本地 API smoke：
  - 系统健康正常
  - 创建账号成功
  - 发起配对成功
  - 账号状态自动变为 connected
  - 自动生成演示聊天和 2 条消息
  - 导出任务完成
  - 审计记录写入成功

## 当前建议

如果接下来要继续推进，优先顺序应该是：

1. 真实 `whatsmeow`
2. 真 live message -> ingest
3. Agent 规则触发和发送主链路
4. 审计 / 系统健康独立页面
