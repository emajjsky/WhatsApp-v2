const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain, session, shell, net: electronNet } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
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
const POSTGRES_SERVICE_NAME = process.env.WA_DESKTOP_POSTGRES_SERVICE || 'WhatsAppAgentPostgres'
const TRAY_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAqElEQVR4nO2T2w2AIBAELcX+LNSytAE49nWaGC/xB4GZPWDb/iJrP4+r+l4Dt4mw4KiIC7ckUnBJAtlwVBEJBcyIyAJK0QJucrQTj6Snu5BOT3eBhbtzLYHE85QFRv/ZNTEBZLxNoGp1VABNiozHBZA7AAs4EhE4IzDbHJlTCqwkZpcPBS/hrsBqLSRQSbAwCT6SUNPKcPQ4WuEpCQvuiMTArEgb+LN1A/nLvdQMEJ6pAAAAAElFTkSuQmCC'

const children = new Set()
let webServer
let apiProcess
let mainWindow
let tray
let isQuitting = false
let shutdownStarted = false
let systemProxyRouteCache = { proxyURL: '', routeKey: '', exitIP: '', checkedAt: 0 }
let systemProxyDetectionPromise
let systemProxyStatus = {
  mode: 'auto',
  status: 'checking',
  proxyURL: '',
  proxyRules: '',
  endpointReachable: false,
  exitIP: '',
  routeKey: '',
  checkedAt: '',
  message: '尚未检测本机系统代理',
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows()
    const window = mainWindow || windows[0]
    if (!window) {
      return
    }
    if (window.isMinimized()) {
      window.restore()
    }
    window.show()
    window.focus()
  })
}

function repoRoot() {
  return path.resolve(__dirname, '..', '..')
}

function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(repoRoot(), 'desktop')
}

function runtimeRoot() {
  return path.join(resourcesRoot(), 'runtime')
}

function userDesktopConfigPath() {
  return path.join(userDataRoot(), 'desktop-config.json')
}

function readJSONFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function packagedDesktopConfig() {
  const candidates = [
    path.join(resourcesRoot(), 'desktop-config.json'),
    path.join(repoRoot(), 'desktop', 'desktop-config.json'),
  ]
  for (const filePath of candidates) {
    const config = readJSONFile(filePath)
    if (Object.keys(config).length > 0) {
      return config
    }
  }
  return {}
}

function ensureUserDesktopConfig(baseConfig) {
  ensureDir(userDataRoot())
  const filePath = userDesktopConfigPath()
  if (fs.existsSync(filePath)) {
    return
  }

  const userConfig = {
    cloudAuthBaseUrl: String(baseConfig.cloudAuthBaseUrl || ''),
    whatsAppProxyMode: String(baseConfig.whatsAppProxyMode || 'auto'),
    whatsAppProxyUrl: String(baseConfig.whatsAppProxyUrl || ''),
  }
  fs.writeFileSync(filePath, `${JSON.stringify(userConfig, null, 2)}\n`, 'utf8')
}

function desktopConfig() {
  const packagedConfig = packagedDesktopConfig()
  ensureUserDesktopConfig(packagedConfig)
  return {
    ...packagedConfig,
    ...readJSONFile(userDesktopConfigPath()),
  }
}

function configString(config, ...keys) {
  for (const key of keys) {
    const value = config[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function publicDesktopConfig() {
  const config = desktopConfig()
  const mode = normalizeProxyMode(configString(config, 'whatsAppProxyMode', 'proxyMode'))
  const manualProxyURL = configString(config, 'whatsAppProxyUrl', 'whatsappProxyUrl', 'whatsAppProxyURL', 'proxyUrl')
  return {
    cloudAuthBaseUrl: configString(config, 'cloudAuthBaseUrl'),
    whatsAppProxyMode: mode,
    whatsAppProxyUrl: manualProxyURL,
    resolvedWhatsAppProxyUrl: '',
  }
}

function writeDesktopConfig(patch) {
  const current = desktopConfig()
  const mode = normalizeProxyMode(
    typeof patch.whatsAppProxyMode === 'string'
      ? patch.whatsAppProxyMode
      : configString(current, 'whatsAppProxyMode', 'proxyMode') || 'auto',
  )
  const next = {
    ...current,
    cloudAuthBaseUrl:
      typeof patch.cloudAuthBaseUrl === 'string' ? patch.cloudAuthBaseUrl.trim() : configString(current, 'cloudAuthBaseUrl'),
    whatsAppProxyMode: mode,
    whatsAppProxyUrl: typeof patch.whatsAppProxyUrl === 'string' ? patch.whatsAppProxyUrl.trim() : publicDesktopConfig().whatsAppProxyUrl,
  }
  fs.writeFileSync(userDesktopConfigPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return publicDesktopConfig()
}

function normalizeProxyMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  if (mode === 'manual' || mode === 'direct' || mode === 'auto') {
    return mode
  }
  return 'auto'
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

function localProxyCredentialKeyPath() {
  return path.join(userDataRoot(), 'local-proxy-credential.key')
}

function localProxyCredentialKey() {
  ensureDir(userDataRoot())
  const filePath = localProxyCredentialKeyPath()
  if (fs.existsSync(filePath)) {
    const value = fs.readFileSync(filePath, 'utf8').trim()
    if (value) {
      return value
    }
  }

  const value = crypto.randomBytes(32).toString('base64')
  fs.writeFileSync(filePath, `${value}\n`, { encoding: 'utf8', mode: 0o600 })
  return value
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

function runSync(name, command, args, options = {}) {
  const result = spawnSync(command, args, {
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  if (result.stdout) {
    appendLog(name, result.stdout)
  }
  if (result.stderr) {
    appendLog(name, result.stderr)
  }
  if (result.error) {
    appendLog(name, `${result.error.message}\n`)
  }
  return result
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

async function startPostgresFixed() {
  const pgBin = path.join(runtimeRoot(), 'postgres', 'bin')
  const postgresExe = requiredFile(path.join(pgBin, 'postgres.exe'), 'PostgreSQL postgres.exe')
  const initdbExe = requiredFile(path.join(pgBin, 'initdb.exe'), 'PostgreSQL initdb.exe')
  const createdbExe = requiredFile(path.join(pgBin, 'createdb.exe'), 'PostgreSQL createdb.exe')
  const psqlExe = requiredFile(path.join(pgBin, 'psql.exe'), 'PostgreSQL psql.exe')
  const pgData = path.join(userDataRoot(), 'postgres-data')

  ensureDir(pgData)
  if (!fs.existsSync(path.join(pgData, 'PG_VERSION'))) {
    const init = await runOnce('postgres-initdb', initdbExe, ['-D', pgData, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8'])
    if (init.code !== 0) {
      throw new Error(`Initialize local PostgreSQL failed: ${init.stderr || init.stdout}`)
    }
  }

  if (process.platform === 'win32') {
    try {
      await waitForPort(POSTGRES_PORT, 1500)
    } catch {
      const start = runSync('postgres-service', systemTool('sc.exe'), ['start', POSTGRES_SERVICE_NAME])
      if (start.status !== 0 && !/1056|started|running|已启动|正在运行/i.test(`${start.stdout}\n${start.stderr}`)) {
        throw new Error('本地数据库服务未正确安装或无法启动，请重新运行安装程序并允许管理员权限。')
      }
      await waitForPort(POSTGRES_PORT, 45000)
    }
  } else {
    spawnManaged('postgres', postgresExe, ['-D', pgData, '-h', '127.0.0.1', '-p', String(POSTGRES_PORT)])
    await waitForPort(POSTGRES_PORT, 45000)
  }

  await ensurePostgresDatabaseSafe(psqlExe, createdbExe)
}

async function ensurePostgresDatabase(psqlExe, createdbExe) {
  const env = { ...process.env, PGCLIENTENCODING: 'UTF8' }
  const exists = await runOnce(
    'postgres-db-check',
    psqlExe,
    [
      '-h',
      '127.0.0.1',
      '-p',
      String(POSTGRES_PORT),
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-tAc',
      `SELECT 1 FROM pg_database WHERE datname='${DATABASE_NAME}'`,
    ],
    { env },
  )
  if (exists.code === 0 && exists.stdout.trim() === '1') {
    return
  }

  const created = await runOnce(
    'postgres-createdb',
    createdbExe,
    ['-h', '127.0.0.1', '-p', String(POSTGRES_PORT), '-U', 'postgres', DATABASE_NAME],
    { env },
  )
  if (created.code !== 0) {
    const combined = `${created.stderr}\n${created.stdout}`
    if (/already exists|已存在|宸茬粡瀛樺湪|涓?瀛樺湪/i.test(combined)) {
      return
    }
    throw new Error(`Create local database failed: ${created.stderr || created.stdout}`)
  }
}

async function ensurePostgresDatabaseSafe(psqlExe, createdbExe) {
  const env = { ...process.env, PGCLIENTENCODING: 'UTF8' }
  if (await postgresDatabaseExists(psqlExe, env)) {
    return
  }

  const created = await runOnce(
    'postgres-createdb',
    createdbExe,
    ['-h', '127.0.0.1', '-p', String(POSTGRES_PORT), '-U', 'postgres', DATABASE_NAME],
    { env },
  )
  if (created.code === 0 || (await postgresDatabaseExists(psqlExe, env))) {
    return
  }

  throw new Error(`Create local database failed: ${created.stderr || created.stdout}`)
}

async function postgresDatabaseExists(psqlExe, env) {
  const exists = await runOnce(
    'postgres-db-check',
    psqlExe,
    [
      '-h',
      '127.0.0.1',
      '-p',
      String(POSTGRES_PORT),
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-tAc',
      `SELECT 1 FROM pg_database WHERE datname='${DATABASE_NAME}'`,
    ],
    { env },
  )
  return exists.code === 0 && exists.stdout.trim() === '1'
}

function systemTool(name) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const candidate = path.join(systemRoot, 'System32', name)
  return fs.existsSync(candidate) ? candidate : name
}

function openPathOrShowError(filePath) {
  shell.openPath(filePath).then((errorMessage) => {
    if (errorMessage) {
      dialog.showErrorBox('Open path failed', `${filePath}\n\n${errorMessage}`)
    }
  })
}

function configureAppMenu() {
  const template = [
    {
      label: 'Desktop',
      submenu: [
        {
          label: 'Open config file',
          click: () => {
            ensureUserDesktopConfig(packagedDesktopConfig())
            openPathOrShowError(userDesktopConfigPath())
          },
        },
        {
          label: 'Open logs folder',
          click: () => {
            ensureDir(logRoot())
            openPathOrShowError(logRoot())
          },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function createTray() {
  if (tray) {
    return
  }

  tray = new Tray(nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, 'base64')))
  tray.setToolTip('WhatsApp Agent')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主界面', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出程序',
        click: () => {
          quitApplication()
        },
      },
    ]),
  )
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

function registerDesktopIPC() {
  ipcMain.handle('desktop-app:version', () => app.getVersion())
  ipcMain.handle('desktop-config:get', async () => desktopRuntimeConfigView())
  ipcMain.handle('desktop-config:save', async (_event, patch) => {
    writeDesktopConfig(patch && typeof patch === 'object' ? patch : {})
    await restartAPI()
    return desktopRuntimeConfigView()
  })
}

async function desktopRuntimeConfigView() {
  const config = publicDesktopConfig()
  return {
    ...config,
    resolvedWhatsAppProxyUrl: await resolveWhatsAppProxyURL(),
  }
}

async function systemProxyRuntimeView(force = false) {
  if (force) {
    systemProxyRouteCache = { proxyURL: '', routeKey: '', exitIP: '', checkedAt: 0 }
  }
  const proxyURL = await resolveWhatsAppProxyURL({ force })
  const config = publicDesktopConfig()
  const routeKey = config.whatsAppProxyMode === 'auto'
    ? await resolveSystemProxyRouteKey(proxyURL, force)
    : ''
  return {
    mode: config.whatsAppProxyMode,
    status: systemProxyStatus.status,
    proxy_url: proxyURL,
    proxy_display_url: redactProxyURL(systemProxyStatus.proxyURL),
    proxy_rules: systemProxyStatus.proxyRules,
    endpoint_reachable: systemProxyStatus.endpointReachable,
    exit_ip: systemProxyStatus.exitIP,
    route_key: routeKey,
    checked_at: systemProxyStatus.checkedAt,
    message: systemProxyStatus.message,
  }
}

function updateSystemProxyStatus(patch) {
  systemProxyStatus = {
    ...systemProxyStatus,
    ...patch,
  }
}

function redactProxyURL(proxyURL) {
  if (!proxyURL) {
    return ''
  }
  try {
    const parsed = new URL(proxyURL)
    parsed.username = ''
    parsed.password = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return proxyURL.replace(/:\/\/[^@/]+@/, '://')
  }
}

async function resolveSystemProxyRouteKey(proxyURL, force = false) {
  if (!proxyURL) {
    systemProxyRouteCache = { proxyURL: '', routeKey: '', exitIP: '', checkedAt: Date.now() }
    updateSystemProxyStatus({ routeKey: '', exitIP: '' })
    return ''
  }
  if (!force && systemProxyRouteCache.proxyURL === proxyURL && Date.now() - systemProxyRouteCache.checkedAt < 15000) {
    updateSystemProxyStatus({ routeKey: systemProxyRouteCache.routeKey, exitIP: systemProxyRouteCache.exitIP })
    return systemProxyRouteCache.routeKey
  }

  const routeKey = await new Promise((resolve) => {
    let request
    try {
      request = electronNet.request({ url: 'https://api.ipify.org', session: session.defaultSession })
    } catch {
      updateSystemProxyStatus({ exitIP: '', message: '系统代理端口可达，但无法启动出口 IP 检测' })
      resolve(proxyURL)
      return
    }
    let body = ''
    const timer = setTimeout(() => {
      request.abort()
      updateSystemProxyStatus({ exitIP: '', message: '系统代理端口可达，但出口 IP 检测超时' })
      resolve(proxyURL)
    }, 5000)
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        body += chunk.toString()
        if (body.length > 64) body = body.slice(0, 64)
      })
      response.on('end', () => {
        clearTimeout(timer)
        const exitIP = body.trim()
        if (response.statusCode === 200 && exitIP) {
          updateSystemProxyStatus({ exitIP, message: '已检测到系统代理，账号独立代理可通过它链式连接' })
        } else {
          updateSystemProxyStatus({ exitIP: '', message: '系统代理端口可达，但出口 IP 暂未返回' })
        }
        resolve(response.statusCode === 200 && exitIP ? `${proxyURL}\x00${exitIP}` : proxyURL)
      })
    })
    request.on('error', () => {
      clearTimeout(timer)
      updateSystemProxyStatus({ exitIP: '', message: '系统代理端口可达，但出口 IP 检测失败' })
      resolve(proxyURL)
    })
    request.end()
  })
  systemProxyRouteCache = { proxyURL, routeKey, exitIP: systemProxyStatus.exitIP, checkedAt: Date.now() }
  updateSystemProxyStatus({ routeKey })
  return routeKey
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

async function resolveWhatsAppProxyURL({ force = false } = {}) {
  const config = desktopConfig()
  const mode = normalizeProxyMode(configString(config, 'whatsAppProxyMode', 'proxyMode'))
  if (mode === 'direct') {
    updateSystemProxyStatus({
      mode,
      status: 'direct',
      proxyURL: '',
      proxyRules: 'DIRECT',
      endpointReachable: false,
      exitIP: '',
      routeKey: '',
      checkedAt: new Date().toISOString(),
      message: '已设置直连，不使用 Clash/系统代理',
    })
    return ''
  }

  const manualProxyURL = configString(config, 'whatsAppProxyUrl', 'whatsappProxyUrl', 'whatsAppProxyURL', 'proxyUrl')
  if (mode === 'manual') {
    const endpointReachable = manualProxyURL ? await isProxyEndpointReachable(manualProxyURL) : false
    updateSystemProxyStatus({
      mode,
      status: endpointReachable ? 'manual' : 'unavailable',
      proxyURL: manualProxyURL,
      proxyRules: manualProxyURL ? `MANUAL ${redactProxyURL(manualProxyURL)}` : '',
      endpointReachable,
      exitIP: '',
      routeKey: '',
      checkedAt: new Date().toISOString(),
      message: endpointReachable ? '已采用手动代理，端口可达' : '手动代理未配置或端口不可达',
    })
    return manualProxyURL
  }

  return (await detectSystemProxyURL('https://web.whatsapp.com/')) || ''
}

async function detectSystemProxyURL(targetURL) {
  if (systemProxyDetectionPromise) {
    return systemProxyDetectionPromise
  }

  systemProxyDetectionPromise = detectSystemProxyURLOnce(targetURL)
  try {
    return await systemProxyDetectionPromise
  } finally {
    systemProxyDetectionPromise = undefined
  }
}

async function detectSystemProxyURLOnce(targetURL) {
  updateSystemProxyStatus({
    mode: 'auto',
    status: 'checking',
    proxyURL: '',
    proxyRules: '',
    endpointReachable: false,
    exitIP: '',
    routeKey: '',
    checkedAt: '',
    message: `正在检测本机系统代理：${targetURL}`,
  })
  try {
    const defaultSession = session.defaultSession
    if (!defaultSession) {
      updateSystemProxyStatus({
        status: 'error',
        checkedAt: new Date().toISOString(),
        message: '桌面网络会话尚未就绪，无法检测系统代理',
      })
      return ''
    }

    const proxyRules = await defaultSession.resolveProxy(targetURL)
    const proxyURL = firstProxyURL(proxyRules)
    updateSystemProxyStatus({ proxyRules: String(proxyRules || '') })
    if (!proxyURL) {
      updateSystemProxyStatus({
        status: 'direct',
        checkedAt: new Date().toISOString(),
        message: '未检测到 Windows 系统代理规则；TUN 模式无法通过此接口确认',
      })
      appendLog('desktop-network', `No system proxy detected for ${targetURL}; using direct network. Rules: ${proxyRules}\n`)
      return ''
    }

    const endpointReachable = await isProxyEndpointReachable(proxyURL)
    updateSystemProxyStatus({ proxyURL, endpointReachable })
    if (!endpointReachable) {
      updateSystemProxyStatus({
        status: 'unavailable',
        checkedAt: new Date().toISOString(),
        message: '已发现系统代理，但代理地址/端口不可达；自动模式不会采用它',
      })
      appendLog('desktop-network', `Detected system proxy is not reachable: ${proxyURL}; using direct network. Rules: ${proxyRules}\n`)
      return ''
    }

    updateSystemProxyStatus({
      status: 'detected',
      checkedAt: new Date().toISOString(),
      message: '已检测到系统代理，正在验证出口并准备链式连接',
    })
    appendLog('desktop-network', `Using detected system proxy: ${proxyURL}. Rules: ${proxyRules}\n`)
    return proxyURL
  } catch (error) {
    updateSystemProxyStatus({
      status: 'error',
      checkedAt: new Date().toISOString(),
      message: `系统代理检测失败：${error.message}`,
    })
    appendLog('desktop-network', `Failed to detect system proxy: ${error.message}\n`)
    return ''
  }
}

function isProxyEndpointReachable(proxyURL) {
  let parsed
  try {
    parsed = new URL(proxyURL)
  } catch {
    return Promise.resolve(false)
  }

  const port = Number(parsed.port || (parsed.protocol.startsWith('socks') ? 1080 : 80))
  if (!parsed.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: parsed.hostname, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 1000)
    const finish = (reachable) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(reachable)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

function firstProxyURL(proxyRules) {
  for (const part of String(proxyRules || '').split(';')) {
    const rule = part.trim()
    if (!rule || /^DIRECT$/i.test(rule)) {
      continue
    }

    const match = /^(PROXY|HTTPS|SOCKS|SOCKS5)\s+(.+)$/i.exec(rule)
    if (!match) {
      continue
    }

    const endpoint = match[2].trim()
    if (!endpoint) {
      continue
    }

    const scheme = /^SOCKS/i.test(match[1]) ? 'socks5' : 'http'
    return `${scheme}://${endpoint}`
  }
  return ''
}

async function startAPI() {
  const identity = desktopIdentity()
  const config = desktopConfig()
  const proxyMode = normalizeProxyMode(configString(config, 'whatsAppProxyMode', 'proxyMode'))
  const configuredProxyURL = configString(config, 'whatsAppProxyUrl', 'whatsappProxyUrl', 'whatsAppProxyURL', 'proxyUrl')
  const whatsAppProxyURL = process.env.WHATSAPP_PROXY_URL || (proxyMode === 'manual' ? configuredProxyURL : '')
  const apiExe = requiredFile(path.join(runtimeRoot(), 'api', 'api-server.exe'), '本地 API 服务')
  ensureDir(dataRoot())
  apiProcess = spawnManaged('api-server', apiExe, [], {
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
      // The desktop endpoint dynamically supplies the current Clash/system
      // proxy so account connections follow node changes without restarting.
      WHATSAPP_PROXY_URL: whatsAppProxyURL,
      SYSTEM_PROXY_PROVIDER_URL: `http://127.0.0.1:${WEB_PORT}/desktop/runtime-proxy`,
      LOCAL_PROXY_CREDENTIAL_KEY: localProxyCredentialKey(),
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

async function restartAPI() {
  if (apiProcess) {
    const current = apiProcess
    apiProcess = undefined
    try {
      current.kill()
    } catch {
      // ignore shutdown races
    }
    if (current.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000)
        current.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }
  await startAPI()
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
  const fail = (error) => {
    if (res.destroyed || res.writableEnded) {
      return
    }
    if (res.headersSent) {
      res.destroy(error)
      return
    }
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: error.message }))
  }

  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: API_PORT,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (apiRes) => {
      if (res.destroyed || res.writableEnded) {
        apiRes.destroy()
        return
      }
      res.writeHead(apiRes.statusCode || 502, apiRes.headers)
      apiRes.once('error', fail)
      apiRes.pipe(res)
    },
  )
  upstream.once('error', fail)
  req.once('aborted', () => upstream.destroy())
  req.once('error', (error) => upstream.destroy(error))
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
  if (webServer) {
    return Promise.resolve()
  }

  const root = requiredFile(path.join(webRoot(), 'index.html'), '前端构建产物')
  const baseDir = path.dirname(root)

  webServer = http.createServer((req, res) => {
    const requestURL = new URL(req.url || '/', `http://127.0.0.1:${WEB_PORT}`)
    if (requestURL.pathname === '/desktop/runtime-proxy') {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      void systemProxyRuntimeView(requestURL.searchParams.get('force') === '1')
        .then((payload) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(payload))
        })
        .catch((error) => {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error.message }))
        })
      return
    }
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
  mainWindow = new BrowserWindow({
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

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return
    }
    event.preventDefault()
    mainWindow.hide()
  })

  await mainWindow.loadURL(`http://127.0.0.1:${WEB_PORT}/`)
}

async function boot() {
  ensureDir(logRoot())
  ensureDir(dataRoot())
  configureAppMenu()
  registerDesktopIPC()
  await startPostgresFixed()
  await startAgentRunner()
  await startWebServer()
  await startAPI()
  await createWindow()
  createTray()
}

function stopChildren() {
  if (webServer) {
    webServer.close()
    webServer = undefined
  }
  for (const child of children) {
    try {
      if (process.platform === 'win32' && child.pid) {
        spawnSync(systemTool('taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } else {
        child.kill()
      }
    } catch {
      // ignore shutdown races
    }
  }
}

function quitApplication() {
  if (shutdownStarted) {
    return
  }
  shutdownStarted = true
  isQuitting = true
  if (tray) {
    tray.destroy()
    tray = undefined
  }
  stopChildren()
  app.exit(0)
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
  try {
    await boot()
  } catch (error) {
    dialog.showErrorBox('WhatsApp Agent 启动失败', `${error.message}\n\n日志目录：${logRoot()}`)
    app.quit()
  }
  })
}

app.on('window-all-closed', () => {
  // The tray keeps the application alive until the user chooses "退出程序".
})

app.on('before-quit', (event) => {
  if (shutdownStarted) {
    return
  }
  event.preventDefault()
  quitApplication()
})
