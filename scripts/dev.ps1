param(
  [switch]$NoDB,
  [switch]$NoAgent,
  [switch]$NoAPI,
  [switch]$NoWeb
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function New-TabArgs {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string]$Command
  )

  return @(
    "new-tab",
    "--title",
    $Title,
    "-d",
    $Directory,
    "powershell.exe",
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $Command
  )
}

$repoRoot = Resolve-RepoRoot
$webDir = Join-Path $repoRoot "web"
$goExe = Join-Path $repoRoot ".tools/go/bin/go.exe"

if (-not (Get-Command wt -ErrorAction SilentlyContinue)) {
  throw "Windows Terminal (wt.exe) not found in PATH."
}

$tabArgs = @()

if (-not $NoDB) {
  $dbCmd = "cd '$repoRoot'; docker compose -f 'deploy/docker/docker-compose.yml' up -d; docker ps"
  if ($tabArgs.Count -gt 0) { $tabArgs += ";" }
  $tabArgs += New-TabArgs -Title "db" -Directory $repoRoot -Command $dbCmd
}

if (-not $NoAgent) {
  $agentCmd = "cd '$repoRoot'; python -m agent_runner.app"
  if ($tabArgs.Count -gt 0) { $tabArgs += ";" }
  $tabArgs += New-TabArgs -Title "agent" -Directory $repoRoot -Command $agentCmd
}

if (-not $NoAPI) {
  if (-not (Test-Path $goExe)) {
    throw "Go toolchain not found at $goExe"
  }
  $apiCmd = "cd '$repoRoot'; `$env:GOCACHE='$repoRoot/.cache/go-build'; `$env:GOMODCACHE='$repoRoot/.cache/gomod'; `$env:GOPROXY='https://goproxy.cn,direct'; & '$goExe' run './cmd/api-server'"
  if ($tabArgs.Count -gt 0) { $tabArgs += ";" }
  $tabArgs += New-TabArgs -Title "api" -Directory $repoRoot -Command $apiCmd
}

if (-not $NoWeb) {
  $webCmd = "cd '$webDir'; npm run dev"
  if ($tabArgs.Count -gt 0) { $tabArgs += ";" }
  $tabArgs += New-TabArgs -Title "web" -Directory $webDir -Command $webCmd
}

if ($tabArgs.Count -eq 0) {
  throw "No services selected. Remove -NoDB/-NoAgent/-NoAPI/-NoWeb."
}

Start-Process -FilePath "wt" -ArgumentList $tabArgs | Out-Null

