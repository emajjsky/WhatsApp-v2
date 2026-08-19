# 生产就绪审查

更新日期：2026-08-20

## 审查结论

`Electron-desktop` 当前核心链路已经具备进入生产验收的基础，但正式开放客户流量前，仍必须完成 HTTPS、默认密码轮换、数据库密码轮换、备份和容量压测。代码通过不等于部署环境已经自动安全，下面的上线门槛不能跳过。

## 本轮已处理

- WhatsApp 内部 `ProtocolMessage` 不再作为普通聊天消息入库和展示。
- 历史库中已有的 `protocol:*` 系统消息在查询层隐藏，纯协议消息会话不再出现在会话列表。
- 消息事件改为有界顺序队列，入库成功后才发布给前端和 Agent，避免历史同步时无限创建 goroutine、事件乱序和 Agent 读取未落库消息。
- Agent `api_key` 和 `authorization` 不再由管理接口明文返回浏览器；编辑时留空会保留服务器原值。
- 自动处理入站消息受 `AGENT_AUTO_SEND_ENABLED` 显式控制，Electron 云端和桌面生产配置均保持关闭。
- Nginx 增加基础安全响应头并隐藏版本信息。
- Electron 云端 Compose 增加 Agent Runner、API、Web 健康检查和依赖就绪条件。
- 本地构建产物 `api-server` 与 `.serena` 工具目录加入 Git 忽略列表。

## 已验证

- 全部 Go 包测试通过。
- `go vet` 通过。
- `internal/agents`、`internal/chats`、`internal/sessions` 竞态检测通过。
- Web ESLint 通过。
- Web TypeScript 与 Vite 生产构建通过。
- Electron 云端 API、Web、Agent Runner Docker 镜像构建通过后方可发布。

## 正式上线阻断项

### 1. HTTPS

当前测试地址使用 `http://服务器IP:8088`。正式环境必须使用域名和 HTTPS，推荐由 Caddy、Nginx 或 DigitalOcean Load Balancer 终止 TLS，然后设置：

```env
APP_ENV=electron-cloud
AUTH_SECURE_COOKIE=true
```

桌面安装包中的 `cloudAuthBaseUrl` 必须改为正式 HTTPS 域名，不能继续使用 HTTP IP。

### 2. 管理员与数据库密码

以下默认值不能用于生产：

```text
admin@example.com
admin123456
postgres
```

管理员账号已写入数据库后，单纯修改 `.env` 不会修改已有用户密码。应在后台重置管理员密码。PostgreSQL 已初始化后更换密码，需要先在数据库执行 `ALTER USER`，再同步修改 `.env`。

### 3. 网络暴露

公网只开放 `22`、`80`、`443`。`5432`、`8080`、`8090` 不得对公网开放。测试端口 `8088` 在正式域名切换完成后应关闭公网访问或只允许管理 IP。

### 4. 备份

至少每天备份云端 PostgreSQL volume，并定期做恢复演练。桌面聊天数据主要保存在用户电脑，正式交付前应明确本地数据目录、磁盘空间和终端备份责任。

### 5. 容量与稳定性验收

正式开放前至少完成：

- 单台客户端 20 至 50 个账号同时在线 24 小时。
- 大历史同步、断网重连、代理切换、客户端重启。
- 多用户并发生成回复、翻译和状态卡。
- Agent API 超时、限流、返回非法 JSON、网络中断。
- 大会话列表、媒体消息和大批量导出。
- 数据库和服务器磁盘告警。

## 发布检查清单

1. `git status` 只包含本次计划发布内容。
2. Go 测试、vet、竞态检测、Web lint/build 全部通过。
3. 三个 Docker 镜像构建通过。
4. `.env` 不含默认密码，且未提交 Git。
5. HTTPS 健康检查和登录回调正常。
6. 管理员 API 响应中不出现真实 API Key。
7. 普通用户只能看到自己的 WhatsApp 账号和聊天。
8. 两个账号同时在线时，协议消息不会显示为聊天内容。
9. 做一次数据库备份并验证可以恢复。
