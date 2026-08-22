# Windows Desktop Packaging

This folder builds the Windows desktop installer. The installer bundles:

- Electron shell
- React web build
- Go API server
- Python embeddable runtime for `agent_runner`
- PostgreSQL Windows binaries for local storage

Users do not need Docker, PostgreSQL, Go, Node.js, or Python installed.

The Windows installer requests administrator permission once to register the
bundled PostgreSQL runtime as a local Windows service. The desktop app itself
runs normally after installation and keeps its database under the current
user's `%APPDATA%/whatsapp-agent-desktop/` directory.

Current packaging version: `0.1.40`.

## Build

Run from `desktop/`:

```powershell
npm install
npm run dist:win
```

The installer is written to `desktop/release/`.

The first successful `npm install` will create `desktop/package-lock.json`.
Commit that lockfile after the installer build is confirmed on the packaging
machine.

If Python or PostgreSQL download fails because of a slow network, place these
files manually before running `npm run dist:win` again:

```text
.cache/desktop/python-3.12.10-embed-amd64.zip
.cache/desktop/postgresql-16.13-1-windows-x64.exe
```

## Runtime Data

The app stores local data under the Electron user data directory:

```text
%APPDATA%/WhatsApp Agent/
```

Important subdirectories:

- `postgres-data/`: local PostgreSQL data directory
- `data/`: exported files, scripts, media cache
- `logs/`: local process logs

Uninstalling the desktop app removes the Windows service but preserves this
local data directory so an upgrade or reinstall does not erase chat data.

## Cloud Auth Plan

The first desktop cut keeps the local API and bundled local database so the Windows installer can run without Docker. The next step is to add a cloud auth proxy:

```text
desktop app -> local API -> cloud auth server
```

WhatsApp sessions and chat data remain local. Cloud only validates user registration, invite code, and license status.

## Admin User Management

The cloud admin page supports changing any user's password, including the
administrator account. Open **用户管理**, select **修改密码**, enter the new
password twice, and save it. Passwords must contain at least 8 characters.

## 0.1.33 修复

- 生成回复时没有客户文字消息，右下角显示明确的中文错误提示。
- 安装新版前自动结束旧版 `WhatsApp Agent.exe` 和本地 API 进程，减少“请先退出软件”的安装失败提示。
- 安装包桌面快捷方式使用与托盘一致的 WhatsApp Agent 图标。

## 0.1.34 代理页面布局

- 新增代理表单改为双列布局，减少页面纵向占用。
- 已保存代理列表与新增表单同屏显示，并支持独立滚动。
- 账号连接说明固定完整显示，避免被窗口底部截断。

## 0.1.35 退出与升级修复

- Windows 退出时按进程树结束本地 API、Agent Runner 等子进程，避免客户端主进程退出后留下运行残留。
- 修正 NSIS 安装器的运行中检查钩子，安装新版前自动结束旧版 `WhatsApp Agent.exe` 及其子进程。

## 0.1.36 本机代理编辑修复

- 已保存代理支持直接编辑，不需要为了更换地址而删除代理。
- 编辑代理时密码留空表示保持原密码，账号绑定关系不会改变。
- 代理仍被 WhatsApp 账号绑定时禁止删除，并提示先解除绑定，避免误断连接。
- 创建或编辑时使用重复名称会提示直接编辑原代理或更换名称。

## 0.1.37 代理删除修复

- 删除代理时，在同一数据库事务内解除当前用户的账号绑定后再删除代理。
- 不删除 WhatsApp 账号、聊天记录或本地会话数据。
- 删除后的账号会回到本机网络；如需立即使用新出口，请重新连接账号。

## 0.1.40 链式代理与配对前置校验

- 修复 Clash 已经链式到账号代理时的重复套链问题，避免 SOCKS5 `EOF`。
- 当 Clash 当前出口与账号代理出口相同时，客户端直接使用 Clash 已完成的链路。
- 账号必须绑定并验证代理后才能生成二维码或配对码。
- 修改代理配置后旧检测结果自动失效；本机网络需要明确选择为仅测试模式。

## 0.1.39 自动链式代理状态

- IP 代理页面增加连接方式：自动判断、直连代理、强制通过 Clash/系统代理链式。
- 客户端自动读取 Windows 系统代理/Clash 当前入口，用户不需要手工填写 Clash 端口。
- 自动模式在境内有 Clash 时走“Clash → 账号独立代理”，境外没有系统代理时直接走账号代理。
- Clash 节点变化后，已连接账号会自动重连以使用新路径。
- 每个账号仍必须绑定不同的独立代理，单个 Clash 节点不能提供多个独立出口 IP。
