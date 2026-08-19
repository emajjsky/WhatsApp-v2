# 服务器部署与更新

这份文档用于服务器版本部署。当前示例按 DigitalOcean Ubuntu 服务器编写，腾讯云、阿里云等 Linux 服务器也基本一样。

`Electron-desktop` 云端鉴权服务请优先参考 `docs/electron-cloud-test-deploy.md`；正式生产要求统一参考 `docs/production-readiness.md`。

## 日常更新

代码已经推送后，在服务器终端执行：

```bash
cd /opt/whatsapp
git pull
docker compose -f deploy/docker/docker-compose.all.yml up -d --build
```

检查服务状态：

```bash
docker compose -f deploy/docker/docker-compose.all.yml ps
curl http://127.0.0.1/healthz
```

浏览器打开：

```text
http://服务器IP
```

如果页面还是旧版本，先强制刷新浏览器缓存：

```text
Ctrl + F5
```

## 只更新前端

如果本次只改了前端页面、样式、图标，可以只重建 `web`：

```bash
cd /opt/whatsapp
git pull
docker compose -f deploy/docker/docker-compose.all.yml up -d --build web
```

如果不确定改动范围，直接用“日常更新”的全量命令更稳。

## 首次部署

### 1. 进入安装目录

```bash
mkdir -p /opt
cd /opt
```

### 2. 拉取代码

GitHub：

```bash
git clone https://github.com/emajjsky/WhatsApp-v2.git whatsapp
```

或 Gitee：

```bash
git clone https://gitee.com/emajjsky/whats-app-v2.git whatsapp
```

进入项目：

```bash
cd /opt/whatsapp
```

### 3. 创建环境变量文件

```bash
cp .env.example .env
```

生产环境至少要改这几项：

```env
AUTH_BOOTSTRAP_ADMIN_EMAIL=你的管理员邮箱
AUTH_BOOTSTRAP_ADMIN_PASSWORD=一个足够强的密码
AUTH_BOOTSTRAP_ADMIN_NAME=Administrator
AUTH_REGISTRATION_ENABLED=true
AUTH_SECURE_COOKIE=false
```

如果后续配置了 HTTPS，把：

```env
AUTH_SECURE_COOKIE=true
```

注意：管理员账号第一次启动后会写入数据库。后面再改 `.env` 里的 `AUTH_BOOTSTRAP_ADMIN_PASSWORD`，不会自动修改已有管理员密码，需要登录后台或数据库里另行处理。

### 4. 设置公网端口

服务器上建议只公开 Web 端口，API、Agent Runner、PostgreSQL 不要直接暴露到公网。

如果当前 `deploy/docker/docker-compose.all.yml` 里 Web 还是：

```yaml
ports:
  - "5173:80"
```

服务器部署时改成：

```yaml
ports:
  - "80:80"
```

建议把内部服务端口改成只监听本机：

```yaml
api:
  ports:
    - "127.0.0.1:8080:8080"

agent-runner:
  ports:
    - "127.0.0.1:8090:8090"

postgres:
  ports:
    - "127.0.0.1:5432:5432"
```

这样外部用户只能访问 `80`，不能直接访问数据库和内部 API。

### 5. 启动服务

```bash
docker compose -f deploy/docker/docker-compose.all.yml up -d --build
```

### 6. 检查服务

```bash
docker compose -f deploy/docker/docker-compose.all.yml ps
curl http://127.0.0.1/healthz
```

正常返回类似：

```json
{"service":"whatsapp-agent-platform","status":"ok"}
```

### 7. 登录后台

浏览器打开：

```text
http://服务器IP
```

如果使用默认配置，首次管理员账号是：

```text
admin@example.com
admin123456
```

生产环境必须尽快改成自己的管理员邮箱和强密码。

## 防火墙

服务器只需要开放：

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

不要开放：

```text
8080
8090
5432
```

这些端口应该只给服务器内部容器访问。

## 常用排查命令

查看容器：

```bash
docker compose -f deploy/docker/docker-compose.all.yml ps
```

查看 API 日志：

```bash
docker compose -f deploy/docker/docker-compose.all.yml logs --tail=120 api
```

查看前端日志：

```bash
docker compose -f deploy/docker/docker-compose.all.yml logs --tail=120 web
```

重启全部服务：

```bash
docker compose -f deploy/docker/docker-compose.all.yml restart
```

停止全部服务：

```bash
docker compose -f deploy/docker/docker-compose.all.yml down
```

注意：不要随便删除 Docker volume，否则数据库和 WhatsApp 会话数据会丢。

## 端口检查

在自己的 Windows 电脑上检查公网 Web 是否通：

```powershell
Test-NetConnection 服务器IP -Port 80
```

结果里看到：

```text
TcpTestSucceeded : True
```

说明网页端口是通的。

检查内部端口时，下面这些从公网失败是正常的：

```powershell
Test-NetConnection 服务器IP -Port 8080
Test-NetConnection 服务器IP -Port 8090
Test-NetConnection 服务器IP -Port 5432
```

这些端口不应该对外开放。

## 后续建议

上线后建议继续做：

- 绑定域名，把 A 记录指向服务器 IP
- 配置 HTTPS
- 开启云厂商自动备份
- 修改 PostgreSQL 默认密码
- 定期更新服务器系统和 Docker 镜像
