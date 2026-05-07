# Electron Desktop Plan

目标形态：

```text
Windows 客户端：本地 WhatsApp 连接、本地聊天记录、本地 AI 辅助
云端服务器：注册登录、邀请码、授权校验、管理员后台
```

## 当前分支

桌面版开发分支：

```text
Electron
```

## 第一版安装包

第一版 Windows 安装包会内置：

- Electron 桌面壳
- React 前端构建产物
- Go API 服务
- Python embeddable runtime
- `agent_runner`
- PostgreSQL Windows runtime

用户电脑不需要安装：

- Docker
- Node.js
- Go
- Python
- PostgreSQL

## 启动流程

用户打开软件后，Electron 自动执行：

```text
1. 启动本地 PostgreSQL
2. 启动本地 agent_runner
3. 启动本地 Go API
4. 启动本地前端静态服务
5. 打开桌面窗口
```

## 云端登录

桌面端前端仍请求本地接口：

```text
POST /api/auth/login
POST /api/auth/register
```

本地 API 如果配置了：

```text
CLOUD_AUTH_BASE_URL=https://你的服务器域名
```

则会先转发到云端：

```text
本地 API -> 云端 /api/auth/login
本地 API -> 云端 /api/auth/register
```

云端验证成功后，本地 API 会把云端用户镜像到本地数据库，并创建本地会话。

## 数据边界

保留在用户本地：

- WhatsApp 登录态
- 聊天记录
- 媒体文件
- 导出文件
- 本地状态卡缓存

保留在云端：

- 用户账号
- 邀请码
- 授权状态
- 管理员后台配置

后续如果需要聊天归档，再新增本地增量上传，不影响当前桌面架构。

## 构建命令

```powershell
cd F:/WhatsApp/whatsapp/desktop
npm install
npm run dist:win
```

安装包输出：

```text
desktop/release/
```

如果 Python 或 PostgreSQL 下载失败，手动下载后放到：

```text
F:/WhatsApp/whatsapp/.cache/desktop/python-3.12.10-embed-amd64.zip
F:/WhatsApp/whatsapp/.cache/desktop/postgresql-16.13-1-windows-x64.exe
```

然后重新执行：

```powershell
npm run dist:win
```

## 服务器部署

云端服务器继续使用现有 Docker 部署：

```bash
cd /opt/whatsapp
git pull
docker compose -f deploy/docker/docker-compose.all.yml up -d --build
```

桌面端发布前，需要把 `CLOUD_AUTH_BASE_URL` 配成云端地址。
