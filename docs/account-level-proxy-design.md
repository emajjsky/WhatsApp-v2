# WhatsApp 一账号一固定 IP 方案

更新日期：2026-08-20

## 目标

让每个 WhatsApp 账号使用独立、固定、可检测的出口 IP，并且账号在重启、重连和客户端升级后仍使用原来的代理，避免同一台电脑上的 20 至 50 个账号全部共享一个公网出口。

这项能力用于网络隔离和稳定运营，不代表可以绕过 WhatsApp 风控。账号行为、设备环境、发送频率、投诉率和内容合规仍会影响账号安全。

## 当前能力与缺口

当前桌面客户端支持自动检测系统代理、直连、手动配置一个全局 HTTP 或 SOCKS5 代理。当前的 `WHATSAPP_PROXY_URL` 是客户端全局配置，同一台客户端上的所有 WhatsApp 账号会共用它，因此当前版本还不满足“一账号一 IP”。

## 推荐架构

### 云端后台

云端只管理代理资产和账号绑定，不承载 WhatsApp 长连接。建议新增 `proxy_endpoints`：

- `id`、`name`、`protocol`
- `host`、`port`、`username`、`encrypted_password`
- `country_code`、`region`、`isp`
- `expected_exit_ip`、`status`、`last_checked_at`、`last_error`
- `created_at`、`updated_at`

建议新增 `whatsapp_account_proxy_bindings`：

- `user_id`
- `desktop_device_id`
- `local_account_id`
- `proxy_id`
- `bound_at`
- `last_verified_at`

绑定唯一键使用 `(user_id, desktop_device_id, local_account_id)`，确保同一个本地 WhatsApp 账号只能绑定一个代理。

### 桌面客户端

每个本地 WhatsApp 账号继续拥有独立的 `whatsmeow.Client`。连接前，客户端使用云端授权身份取得该账号的代理配置，再为这个客户端实例设置独立 transport。

实现接口建议从当前全局字符串改为：

```go
type AccountProxyResolver interface {
    ResolveProxy(ctx context.Context, accountID string) (*ProxyConfig, error)
}
```

`WhatsmeowConnector` 在创建或恢复账号会话时按 `accountID` 解析代理。二维码登录、WebSocket、历史同步、媒体上传下载、WhatsApp Web 版本检测都必须使用同一个账号代理。

## 粘性规则

- 同一 WhatsApp 账号固定绑定同一个代理，不做请求级或分钟级轮换。
- 代理不可用时先停止该账号连接并告警，不自动切换到随机国家或随机 IP。
- 确需更换代理时由管理员明确操作，并记录旧 IP、新 IP、时间和原因。
- 代理国家尽量与手机号归属、账号长期使用地区和业务地区保持一致。
- 不同账号可以属于同一国家，但出口 IP 应独立或按明确的小组隔离。

## 凭据安全

- 代理密码在云端数据库中加密保存，密钥放在服务器环境变量或密钥管理服务中。
- 管理接口只返回 `password_configured=true`，不把真实密码返回浏览器。
- 桌面端只在建立连接时获取必要凭据，不写入前端 LocalStorage，不打印到日志。
- 云端接口必须使用 HTTPS，并校验用户、设备和本地账号绑定关系。

## 连接前检测

扫码前执行：

1. TCP/代理握手检测。
2. WhatsApp 所需域名和 `443` 连通性检测。
3. 查询出口公网 IP。
4. 校验国家/地区。
5. 记录延迟、出口 IP 和检测时间。

检测失败时在账号卡片显示明确原因，不能静默回退到本机直连，否则会破坏账号 IP 粘性。

## 分阶段落地

### 第一阶段：小规模验证

- 购买 2 至 5 个印尼静态住宅或静态 ISP 代理。
- 在一台测试电脑上给 2 至 5 个测试账号逐一绑定。
- 连续运行 7 天，验证重启、重连、扫码、收发消息和媒体。

不要使用免费公共代理。免费代理通常存在共享人数高、IP 污染、掉线、流量劫持和凭据泄露风险，只适合验证界面流程，不适合登录真实账号。

### 第二阶段：后台代理池

- 增加代理 CRUD、批量导入、连通性检测和账号绑定页面。
- 桌面端增加账号级代理选择与状态展示。
- 云端保存绑定，桌面端按账号拉取。

### 第三阶段：生产监控

- 代理可用率、延迟、出口 IP 变化告警。
- 账号重连次数和网络错误统计。
- 代理到期提醒和人工迁移流程。
- 代理供应商质量报表。

## 验收标准

- 同一台电脑同时在线两个账号，检测到的出口 IP 不同。
- 每个账号的二维码登录、消息、媒体请求都走绑定代理。
- 客户端和电脑重启后绑定关系不变。
- 代理异常时不自动泄漏到本机公网 IP。
- 普通用户不能读取其他用户的代理信息。
- 浏览器响应、桌面日志和服务端日志中不出现代理密码。
