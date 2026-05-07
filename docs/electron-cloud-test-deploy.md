# Electron 云端测试部署

这套部署只用于 `Electron-desktop` 分支，不影响 `main` 云端 Web 版。

## 部署目标

当前测试阶段可以和 `main` 放在同一台服务器，通过端口区分：

```text
main Web 版：      http://188.166.248.178
Electron 云端版： http://188.166.248.178:8088
```

Electron 云端版使用独立 Docker project、独立 PostgreSQL volume、独立容器名，不和 `main` 共用数据库。

## 架构边界

Electron 方案分两部分：

1. 云端：负责注册登录、邀请码、用户权限、桌面授权、设备管理、智能体配置、Agent 执行。
2. 桌面端：负责本机 WhatsApp 登录、本地聊天数据、本地导出、把必要聊天上下文发送到云端 Agent。

模型 API Key、Coze/n8n/Webhook 地址等智能体配置只放在云端后台，不放在用户电脑里。

## 首次部署

```bash
cd /opt
git clone -b Electron-desktop https://gitee.com/emajjsky/whats-app-v2.git whatsapp-electron-cloud
cd /opt/whatsapp-electron-cloud
```

创建 `.env`：

```bash
cat > .env <<'EOF'
AUTH_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
AUTH_BOOTSTRAP_ADMIN_PASSWORD=admin123456
AUTH_BOOTSTRAP_ADMIN_NAME=Administrator
AUTH_REGISTRATION_ENABLED=true
AUTH_SECURE_COOKIE=false
LOG_LEVEL=info
EOF
```

启动：

```bash
docker compose -f deploy/docker/docker-compose.electron-cloud.yml up -d --build
```

检查：

```bash
docker compose -f deploy/docker/docker-compose.electron-cloud.yml ps
curl http://127.0.0.1:8088/healthz
```

浏览器打开：

```text
http://188.166.248.178:8088
```

默认管理员：

```text
admin@example.com
admin123456
```

上线前必须在后台修改默认密码。

## 更新部署

```bash
cd /opt/whatsapp-electron-cloud
git fetch origin
git checkout Electron-desktop
git pull origin Electron-desktop
docker compose -f deploy/docker/docker-compose.electron-cloud.yml up -d --build
docker compose -f deploy/docker/docker-compose.electron-cloud.yml ps
```

## 后台配置顺序

1. 管理员登录 `http://188.166.248.178:8088`。
2. 在后台创建邀请码。
3. 用户用邀请码注册。
4. 管理员在用户管理里打开该用户的桌面端权限。
5. 设置该用户最大设备数和授权到期时间。
6. 在后台配置回复 Agent、翻译 Agent、状态卡 Agent。

## 桌面安装包连接云端

打包 Windows 安装包前，修改：

```text
desktop/desktop-config.json
```

写入：

```json
{
  "cloudAuthBaseUrl": "http://188.166.248.178:8088"
}
```

然后重新打包：

```powershell
cd F:/WhatsApp/whatsapp-electron/desktop
npm run dist:win
```

生成文件：

```text
desktop/release/WhatsApp Agent Setup 0.1.0.exe
```

## Agent 调用方式

桌面端前端仍然调用本地接口：

```text
/api/agent-runs/generate/stream
/api/agent-translations
/api/agent-status-card
```

当本地 API 检测到 `CLOUD_AUTH_BASE_URL` 后，会自动把聊天上下文转发到云端：

```text
/api/desktop/agent-runs/generate/stream
/api/desktop/agent-translations
/api/desktop/agent-status-card
```

云端使用管理员后台配置的 Agent 和 API Key 执行，结果返回桌面端，桌面端再保存草稿、翻译和状态卡。
