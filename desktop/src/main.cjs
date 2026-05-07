const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const API_PORT = Number(process.env.WA_DESKTOP_API_PORT || 18080)
const AGENT_PORT = Number(process.env.WA_DESKTOP_AGENT_PORT || 18090)
const POSTGRES_PORT = Number(process.env.WA_DESKTOP_POSTGRES_PORT || 15432)
const WEB_PORT = Number(process.env.WA_DESKTOP_WEB_PORT || 18100)
const DATABASE_NAME = 'whatsapp_agent_platform'

const children = new Set()
let webServer

function repoRoot() {
  return path.resolve(__dirname, '..', '..')
}

function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(repoRoot(), 'desktop')
}

function runtimeRoot() {
  return path.join(resourcesRoot(), 'runtime')
}

function desktopConfig() {
  const candidates = [
    path.join(resourcesRoot(), 'desktop-config.json'),
    path.join(repoRoot(), 'desktop', 'desktop-config.json'),
  ]
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch {
      return {}
    }
  }
  return {}
}

function webRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(repoRoot(), 'web', 'dist')
}

function migrationsRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'deploy', 'migrations') : path.join(repoRoot(), 'deploy', 'migrations')
}

function userDataRoot() {
  return app.getPath('userData')
}

function dataRoot() {
  return path.join(userDataRoot(), 'data')
}

function desktopIdentityPath() {
  return path.join(userDataRoot(), 'desktop-device.json')
}

function desktopIdentity() {
  ensureDir(userDataRoot())
  const filePath = desktopIdentityPath()
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (parsed && typeof parsed.device_id === 'string' && parsed.device_id.trim()) {
        return {
          deviceID: parsed.device_id.trim(),
          deviceName: String(parsed.device_name || os.hostname() || 'Windows PC'),
        }
      }
    } catch {
      // Regenerate below.
    }
  }

  const identity = {
    device_id: crypto.randomUUID(),
    device_name: os.hostname() || 'Windows PC',
  }
  fs.writeFileSync(filePath, JSON.stringify(identity, null, 2))
  return {
    deviceID: identity.device_id,
    deviceName: identity.device_name,
  }
}

function logRoot() {
  return path.join(userDataRoot(), 'logs')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function requiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} 不存在：${filePath}`)
  }
  return filePath
}

function appendLog(name, chunk) {
  ensureDir(logRoot())
  fs.appendFileSync(path.join(logRoot(), `${name}.log`), chunk)
}

function spawnManaged(name, command, args, options = {}) {
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  children.add(child)
  child.stdout.on('data', (chunk) => appendLog(name, chunk))
  child.stderr.on('data', (chunk) => appendLog(name, chunk))
  child.once('exit', () => children.delete(child))
  return child
}

function runOnce(name, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      appendLog(name, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      appendLog(name, chunk)
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
}

function waitForPort(port, timeoutMs = 30000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.end()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`等待端口 ${port} 启动超时`))
          return
        }
        setTimeout(attempt, 350)
      })
    }
    attempt()
  })
}

async function waitForHTTP(url, timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        const request = http.get(url, (response) => {
          response.resume()
          resolve(response.statusCode >= 200 && response.statusCode < 500)
        })
        request.setTimeout(1500, () => {
          request.destroy()
          resolve(false)
        })
        request.on('error', () => resolve(false))
      })
      if (ok) {
        return
      }
    } catch {
      // retry below
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(`等待服务 ${url} 启动超时`)
}

async function startPostgres() {
  const pgBin = path.join(runtimeRoot(), 'postgres', 'bin')
  const postgresExe = requiredFile(path.join(pgBin, 'postgres.exe'), 'PostgreSQL postgres.exe')
  const initdbExe = requiredFile(path.join(pgBin, 'initdb.exe'), 'PostgreSQL initdb.exe')
  const createdbExe = requiredFile(path.join(pgBin, 'createdb.exe'), 'PostgreSQL createdb.exe')
  const pgData = path.join(userDataRoot(), 'postgres-data')

  ensureDir(pgData)
  if (!fs.existsSync(path.join(pgData, 'PG_VERSION'))) {
    const init = await runOnce('postgres-initdb', initdbExe, ['-D', pgData, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8'])
    if (init.code !== 0) {
      throw new Error(`初始化本地 PostgreSQL 失败：${init.stderr || init.stdout}`)
    }
  }

  spawnManaged('postgres', postgresExe, ['-D', pgData, '-h', '127.0.0.1', '-p', String(POSTGRES_PORT)])
  await waitForPort(POSTGRES_PORT, 45000)

  const created = await runOnce(
    'postgres-createdb',
    createdbExe,
    ['-h', '127.0.0.1', '-p', String(POSTGRES_PORT), '-U', 'postgres', DATABASE_NAME],
    { env: { ...process.env, PGCLIENTENCODING: 'UTF8' } },
  )
  if (created.code !== 0 && !/already exists/i.test(`${created.stderr}\n${created.stdout}`)) {
    throw new Error(`创建本地数据库失败：${created.stderr || created.stdout}`)
  }
}

function startAgentRunner() {
  const pythonExe = requiredFile(path.join(runtimeRoot(), 'python', 'python.exe'), 'Python 运行时')
  requiredFile(path.join(runtimeRoot(), 'agent_runner', 'app.py'), 'agent_runner')
  spawnManaged('agent-runner', pythonExe, ['-m', 'agent_runner.app'], {
    cwd: runtimeRoot(),
    env: {
      ...process.env,
      AGENT_RUNNER_HOST: '127.0.0.1',
      AGENT_RUNNER_PORT: String(AGENT_PORT),
      AGENT_RUNNER_DEFAULT_PROVIDER: process.env.AGENT_RUNNER_DEFAULT_PROVIDER || 'mock',
    },
  })
  return waitForHTTP(`http://127.0.0.1:${AGENT_PORT}/healthz`, 30000)
}

function startAPI() {
  const identity = desktopIdentity()
  const config = desktopConfig()
  const apiExe = requiredFile(path.join(runtimeRoot(), 'api', 'api-server.exe'), '本地 API 服务')
  ensureDir(dataRoot())
  spawnManaged('api-server', apiExe, [], {
    cwd: userDataRoot(),
    env: {
      ...process.env,
      APP_NAME: 'whatsapp-agent-platform',
      APP_ENV: 'desktop',
      HTTP_HOST: '127.0.0.1',
      HTTP_PORT: String(API_PORT),
      DB_DRIVER: 'postgres',
      DB_DSN: `postgres://postgres@127.0.0.1:${POSTGRES_PORT}/${DATABASE_NAME}?sslmode=disable`,
      DB_AUTO_MIGRATE: 'true',
      DB_MIGRATIONS_DIR: migrationsRoot(),
      AUTH_COOKIE_NAME: 'wa_desktop_session',
      AUTH_REGISTRATION_ENABLED: 'true',
      AUTH_BOOTSTRAP_ADMIN_EMAIL: process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com',
      AUTH_BOOTSTRAP_ADMIN_PASSWORD: process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD || 'admin123456',
      AUTH_BOOTSTRAP_ADMIN_NAME: process.env.AUTH_BOOTSTRAP_ADMIN_NAME || 'Administrator',
      AUTH_SECURE_COOKIE: 'false',
      AGENT_RUNNER_BASE_URL: `http://127.0.0.1:${AGENT_PORT}`,
      CLOUD_AUTH_BASE_URL: process.env.CLOUD_AUTH_BASE_URL || config.cloudAuthBaseUrl || '',
      WA_DESKTOP_DEVICE_ID: identity.deviceID,
      WA_DESKTOP_DEVICE_NAME: identity.deviceName,
      WA_DESKTOP_APP_VERSION: app.getVersion(),
      AGENT_AUTO_SEND_ENABLED: 'false',
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      LOG_FORMAT: 'text',
    },
  })
  return waitForHTTP(`http://127.0.0.1:${API_PORT}/healthz`, 45000)
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.svg':
      return 'image/svg+xml'
    case '.ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
}

function proxyToAPI(req, res) {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: API_PORT,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (apiRes) => {
      res.writeHead(apiRes.statusCode || 502, apiRes.headers)
      apiRes.pipe(res)
    },
  )
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: error.message }))
  })
  req.pipe(upstream)
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  if (decoded === '/' || decoded === '') {
    return 'index.html'
  }

  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  return normalized.replace(/^[/\\]+/, '')
}

function startWebServer() {
  const root = requiredFile(path.join(webRoot(), 'index.html'), '前端构建产物')
  const baseDir = path.dirname(root)

  webServer = http.createServer((req, res) => {
    if (req.url.startsWith('/api/') || req.url === '/healthz') {
      proxyToAPI(req, res)
      return
    }

    let filePath = path.join(baseDir, safeStaticPath(req.url))
    if (!filePath.startsWith(baseDir)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(baseDir, 'index.html')
    }

    res.writeHead(200, { 'content-type': contentType(filePath) })
    fs.createReadStream(filePath).pipe(res)
  })

  return new Promise((resolve, reject) => {
    webServer.once('error', reject)
    webServer.listen(WEB_PORT, '127.0.0.1', () => resolve())
  })
}

async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(`http://127.0.0.1:${WEB_PORT}/`)
}

async function boot() {
  ensureDir(logRoot())
  ensureDir(dataRoot())
  await startPostgres()
  await startAgentRunner()
  await startAPI()
  await startWebServer()
  await createWindow()
}

function stopChildren() {
  if (webServer) {
    webServer.close()
    webServer = undefined
  }
  for (const child of children) {
    try {
      child.kill()
    } catch {
      // ignore shutdown races
    }
  }
}

app.whenReady().then(async () => {
  try {
    await boot()
  } catch (error) {
    dialog.showErrorBox('WhatsApp Agent 启动失败', `${error.message}\n\n日志目录：${logRoot()}`)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', stopChildren)
