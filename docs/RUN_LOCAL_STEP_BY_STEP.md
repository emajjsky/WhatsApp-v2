# 本地运行步骤

这份文档按你现在这台 Windows 机器来写，默认你已经有：

- Docker Desktop
- Python
- Node.js / npm
- Clash Verge

目标是把这 4 个东西都跑起来：

1. PostgreSQL
2. agent_runner
3. Go API
4. 前端页面

最后你能在网页里：

- 创建账号
- 点击二维码配对
- 看到真实二维码
- 用手机 WhatsApp 扫码

## 先确认代理

你截图里能看到：

- 混合代理端口：`59341`
- SOCKS5 代理端口：`7898`
- HTTP(S) 代理端口：`7899`

推荐先直接用混合代理端口，不用折腾开关：

```powershell
http://127.0.0.1:59341
```

如果后面还是连不上，再改成：

```powershell
http://127.0.0.1:7899
```

前提是 Clash Verge 里的 `HTTP(S) 代理端口` 已经打开。

## 一共开 4 个终端

建议你打开 4 个 PowerShell 窗口，名字自己记一下：

1. `终端1-数据库`
2. `终端2-agent`
3. `终端3-api`
4. `终端4-web`

项目目录是：

```powershell
F:\WhatsApp\whatsapp
```

---

## 第 1 步：启动数据库

在 `终端1-数据库` 里执行：

```powershell
cd "F:\WhatsApp\whatsapp"
docker compose -f "deploy/docker/docker-compose.yml" up -d
```

看到容器成功启动就行。

你也可以再检查一下：

```powershell
docker ps
```

正常情况下会看到一个名字类似：

```text
whatsapp-agent-platform-postgres
```

---

## 第 2 步：启动 agent_runner

在 `终端2-agent` 里执行：

```powershell
cd "F:\WhatsApp\whatsapp"
python -m agent_runner.app
```

正常的话会打印一行 JSON，大概像这样：

```json
{"service":"agent-runner","host":"127.0.0.1","port":8090,"default_provider":"mock"}
```

这个窗口不要关。

---

## 第 3 步：启动后端 API

这一步最重要。

### 3.1 先清掉旧的 8080 进程

有时候你前面起过一次 API，但窗口关了或者进程没退干净，`8080` 会被旧进程继续占着。

先在 `终端3-api` 里执行：

```powershell
$portOwner = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1 -ExpandProperty OwningProcess
if ($portOwner) { Stop-Process -Id $portOwner -Force }
```

然后检查一下：

```powershell
Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess
```

### 你看到什么算正常

- 如果只剩一堆：

```text
TimeWait    0
```

这是正常的，不用管。

- 如果还能看到：

```text
Listen    某个进程号
```

说明还有别的程序占着 `8080`，要继续杀掉那个进程。

### 3.2 再启动 API

确认 `8080` 没有 `Listen` 之后，再整段复制执行：

```powershell
cd "F:\WhatsApp\whatsapp"

$env:APP_NAME='whatsapp-agent-platform'
$env:APP_ENV='development'
$env:HTTP_HOST='127.0.0.1'
$env:HTTP_PORT='8080'

$env:DB_DRIVER='postgres'
$env:DB_DSN='postgres://postgres:postgres@127.0.0.1:5432/whatsapp_agent_platform?sslmode=disable'
$env:DB_AUTO_MIGRATE='true'
$env:DB_MIGRATIONS_DIR='deploy/migrations'

$env:LOG_LEVEL='debug'
$env:LOG_FORMAT='text'

$env:AGENT_RUNNER_BASE_URL='http://127.0.0.1:8090'

$env:WHATSAPP_PROXY_URL='http://127.0.0.1:59341'

$env:GOCACHE='F:/WhatsApp/whatsapp/.cache/go-build'
$env:GOMODCACHE='F:/WhatsApp/whatsapp/.cache/gomod'
$env:GOPROXY='https://goproxy.cn,direct' 
& "F:\WhatsApp\whatsapp\.tools\go\bin\go.exe" run "./cmd/api-server"
```

### 这一行最关键

```powershell
$env:WHATSAPP_PROXY_URL='http://127.0.0.1:59341'
```

这是让后端通过 Clash Verge 去连 WhatsApp。

如果你后面发现还是连不上，再把它改成：

```powershell
$env:WHATSAPP_PROXY_URL='http://127.0.0.1:7899'
```

但前提是 Clash Verge 里 `HTTP(S) 代理端口` 已经开启。

### API 启动成功长什么样

正常会看到类似：

```text
application assembled
starting http server
```

并且这个窗口会停在那里，不会立刻退出。

这个窗口也不要关。

---

## 第 4 步：启动前端

在 `终端4-web` 里执行：

```powershell
cd "F:\WhatsApp\whatsapp\web"
npm run dev
```

正常会出现一个本地地址，一般像：

```text
http://localhost:5173/
```

浏览器打开它。

---

## 第 5 步：在网页里操作

打开网页后，按这个顺序来。

### 5.1 进入“账号接入”

左侧点：

```text
账号接入
```

### 5.2 创建一个账号

表单里填：

- 账号名称：随便写，比如 `我的测试号`
- 手机号：建议填你的真实 WhatsApp 手机号，国际格式
  例子：
  ```text
  8613812345678
  ```
- 内部标签：随便写，比如 `本机测试`

然后点：

```text
创建账号
```

### 5.3 开始二维码配对

选中刚创建的账号。

点：

```text
开始二维码配对
```

正常情况右边会出现：

- 一个真正的二维码图片
- 或者配对失败原因

### 5.4 用手机扫码

手机 WhatsApp 里找：

```text
设置 -> 已关联设备 -> 关联设备
```

然后扫网页上的二维码。

扫完之后网页会自动轮询状态，成功时会变成：

```text
已连接
```

---

## 如果失败，先看哪里

账号右边会直接显示失败原因。

你重点看这几种情况。

### 情况 1：连不上 WhatsApp

如果错误里有类似：

```text
failed to dial whatsapp web websocket
```

或者：

```text
web.whatsapp.com
```

说明还是网络问题。

先做这两个动作：

1. 确认 Clash Verge 已经开着
2. 把 API 终端里的代理从 `59341` 改成 `7899` 再重启 API

也就是把这一行：

```powershell
$env:WHATSAPP_PROXY_URL='http://127.0.0.1:59341'
```

改成：

```powershell
$env:WHATSAPP_PROXY_URL='http://127.0.0.1:7899'
```

然后重新运行整段 API 启动命令。

### 情况 2：手机号重复

如果报错里有类似：

```text
duplicate key value violates unique constraint
```

说明你创建过同一个手机号的账号了。

解决方法：

- 换一个没用过的手机号测试
- 或者让我后面给你补“删除账号”功能

### 情况 3：二维码一直不出来

先等几秒。

如果还是没有：

1. 看 API 终端有没有报错
2. 看账号页右边有没有失败提示
3. 刷新页面一次

### 情况 4：API 一启动就报 8080 端口被占用

如果报错里有类似：

```text
listen tcp 127.0.0.1:8080: bind
```

说明旧 API 进程还活着。

重新执行下面这两条：

```powershell
$portOwner = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1 -ExpandProperty OwningProcess
if ($portOwner) { Stop-Process -Id $portOwner -Force }
```

然后再执行：

```powershell
& "F:\WhatsApp\whatsapp\.tools\go\bin\go.exe" run "./cmd/api-server"
```

注意：

- `TimeWait 0` 不用管
- 只有 `Listen 某个进程号` 才说明真的被占用

---

## 最小重启方法

如果你改了代理，最少重启这 2 个：

1. `终端3-api`
2. 浏览器页面刷新

通常数据库和 agent_runner 不用重启。

---

## 最笨但稳的完整重来

如果你搞乱了，就按这个顺序重来：

1. 关掉 4 个终端
2. 保留 Clash Verge 开着
3. 重新开 4 个终端
4. 按本文档从第 1 步重新执行

---

## 当前最重要的判断标准

你不用管后面那些 Agent、导出、聊天页面先多高级。

你现在只看一件事：

```text
账号接入页能不能出现真实二维码，并且扫码后变成已连接
```

只要这一步通了，后面才叫“真能用起来”。

---

## 你下一步直接照着做

你现在就按本文档：

1. 开 4 个终端
2. 跑数据库
3. 跑 agent_runner
4. 跑 API
5. 跑前端
6. 去账号接入页点“开始二维码配对”

如果做到哪一步报错了，把 **那个终端里最后 20 行内容** 发我，我直接接着给你改，不让你自己瞎猜。
