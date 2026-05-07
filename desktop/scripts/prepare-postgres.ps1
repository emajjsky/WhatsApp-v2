param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path,
  [string]$RuntimeDir = (Resolve-Path "$PSScriptRoot/..").Path + "/runtime",
  [string]$PostgresInstaller = "",
  [string]$PostgresUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.13-1-windows-x64.exe"
)

$ErrorActionPreference = "Stop"

$postgresDir = Join-Path $RuntimeDir "postgres"
$cacheDir = Join-Path $RepoRoot ".cache/desktop"
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

if (Test-Path (Join-Path $postgresDir "bin/postgres.exe")) {
  Write-Host "PostgreSQL runtime already exists."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PostgresInstaller)) {
  $PostgresInstaller = Join-Path $cacheDir "postgresql-16.13-1-windows-x64.exe"
}

if (-not (Test-Path $PostgresInstaller)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $PostgresUrl -OutFile $PostgresInstaller
}

if (Test-Path $postgresDir) {
  Remove-Item -LiteralPath $postgresDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $postgresDir | Out-Null

$args = @(
  "--mode", "unattended",
  "--unattendedmodeui", "none",
  "--prefix", $postgresDir,
  "--serverport", "15432",
  "--superaccount", "postgres",
  "--superpassword", "postgres",
  "--serviceaccount", "postgres",
  "--servicepassword", "postgres",
  "--servicename", "whatsapp-postgres"
)

& $PostgresInstaller @args
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL installer failed"
}

if (-not (Test-Path (Join-Path $postgresDir "bin/postgres.exe"))) {
  $found = Get-ChildItem -Path $postgresDir -Recurse -Filter "postgres.exe" | Select-Object -First 1
  if (-not $found) {
    throw "PostgreSQL runtime is incomplete."
  }
}
