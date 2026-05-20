# 当前进度

更新日期：2026-05-08

## 一句话说明

当前项目已经拆成两条交付路线：

- `main`：云端 Web 部署版，继续作为服务器 Web 使用路径。
- `Electron-desktop`：桌面安装包 + 云端鉴权后台路径，当前重点开发和测试这一条。

两条路线不要混着改。云端 Web 版问题修 `main`，桌面安装包问题修 `Electron-desktop`。

## 当前分支状态

当前工作目录：`F:/WhatsApp/whatsapp-electron`

当前分支：`Electron-desktop`

最新已完成重点：

- 桌面端可以连接云端鉴权服务。
- 云端后台可以管理用户、邀请码、权限和智能体配置。
- 桌面端可以使用云端后台配置的回复 Agent、翻译 Agent、状态卡 Agent。
- Electron 云端服务已支持独立部署，不影响 `main`。
- Windows 安装包已生成到 `desktop/release/`。
- macOS 安装包暂未生成，后续需要在 macOS 环境补充打包、签名和公证流程。

## 已完成

### 1. 云端鉴权与后台

- 注册登录已接入。
- 管理员账号已接入。
- 邀请码注册流程已接入。
- 用户管理、权限管理、设备授权已接入。
- 云端后台在 `APP_ENV=electron-cloud` 下只显示后台功能。
- Electron 云端服务不再展示 WhatsApp 登录、对话、话术和导出页面。

### 2. 智能体配置

- 回复 Agent 支持云端统一配置。
- 翻译 Agent 支持云端统一配置。
- 状态卡 Agent 支持云端统一配置。
- 桌面端用户不需要在本机填写模型 API Key。
- 桌面端通过本地 API 代理到云端 Agent 执行，返回结果后再写入桌面端界面。

### 3. 桌面端能力

- 桌面端负责本机 WhatsApp 登录、二维码、会话、消息、媒体和导出。
- 桌面端支持自动检测系统代理、直连、手动代理三种 WhatsApp 网络模式。
- 代理配置已经放到界面，不需要普通用户手改配置文件。
- 桌面端登录后可以根据云端授权控制可用能力。

### 4. Windows 安装包

当前已有 Windows 安装包：

```text
desktop/release/WhatsApp Agent Setup 0.1.8.exe
```

安装新版本通常可以直接覆盖安装，不需要先卸载旧版本。

### 5. 状态卡问题修复

已修复桌面端状态卡保存失败的问题。

原因是桌面本地数据库的 `chat_status_cards.agent_id` 原本强依赖本地 `system_agents`，但现在桌面端使用的是云端 Agent ID，本地不存在对应记录。

处理方式：

- 新安装数据库不再给 `chat_status_cards.agent_id` 加本地外键。
- 老数据库通过新 migration 删除旧外键约束。

相关迁移：

```text
deploy/migrations/0017_chat_status_cards_cloud_agents.sql
```

## 当前未完成

### 1. macOS 安装包

目前还没有 macOS 安装包。

后续建议分两步：

1. 先做未签名测试版 `.dmg` 或 `.zip`，用于内部测试。
2. 稳定后再接 Apple Developer 签名和 notarization 公证。

正式 Mac 包最好在 macOS 环境生成，Windows 上不适合完整处理签名和公证。

### 2. 桌面端长期稳定性测试

还需要继续验证：

- 多账号同时在线。
- 长时间运行后的消息同步。
- 网络切换、代理切换后的重连。
- 媒体消息收发和导出。
- 云端 Agent 调用失败时的前端提示。

### 3. 聊天记录上传云端

当前没有做“每日自动上传全部聊天记录到服务器”的能力。

现在的边界是：

- 聊天记录主要保存在用户本机。
- 云端只负责鉴权、用户、权限、邀请码、智能体配置和 Agent 执行。
- 后续如果客户需要集中审计或服务顾问统一查看聊天记录，再单独设计上传任务和服务端存储。

## 当前可验收

- Electron 云端后台部署。
- 管理员登录后台。
- 邀请码创建与注册。
- 用户授权桌面端。
- Windows 桌面端安装和登录。
- 桌面端 WhatsApp 扫码登录。
- 桌面端使用云端配置的回复 Agent。
- 桌面端使用云端配置的翻译 Agent。
- 桌面端使用云端配置的状态卡 Agent。

## 服务器更新命令

Electron 云端测试服务更新：

```bash
cd /opt/whatsapp-electron-cloud
git pull origin Electron-desktop
docker compose -f deploy/docker/docker-compose.electron-cloud.yml up -d --build
```

更新后检查：

```bash
docker compose -f deploy/docker/docker-compose.electron-cloud.yml ps
curl http://127.0.0.1:8088/healthz
```

## 下一步建议

1. 继续用 Windows 安装包 `0.1.8` 跑完整桌面端验收。
2. 如果状态卡、翻译、回复都稳定，再补 macOS 打包配置。
3. macOS 先做内部测试包，确认功能稳定后再做签名和公证。
4. 聊天记录上传云端先不急，等桌面版核心链路稳定后再单独设计。
