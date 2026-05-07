param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path,
  [string]$OutputDir = (Resolve-Path "$PSScriptRoot/..").Path + "/runtime/api"
)

$ErrorActionPreference = "Stop"

$candidateGoPaths = @(
  (Join-Path $RepoRoot ".tools/go/bin/go.exe"),
  (Join-Path (Split-Path $RepoRoot -Parent) "whatsapp/.tools/go/bin/go.exe")
)

$go = $candidateGoPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $go) {
  $pathGo = Get-Command "go.exe" -ErrorAction SilentlyContinue
  if ($pathGo) {
    $go = $pathGo.Source
  }
}

if (-not $go) {
  throw "Go toolchain not found. Install Go, or place it at .tools/go/bin/go.exe."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot ".cache/go-build") | Out-Null

$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "1"
$env:GOCACHE = (Join-Path $RepoRoot ".cache/go-build")
$env:GOTELEMETRY = "off"

Push-Location $RepoRoot
try {
  & $go build -trimpath -ldflags="-s -w" -o (Join-Path $OutputDir "api-server.exe") "./cmd/api-server"
  if ($LASTEXITCODE -ne 0) {
    throw "api-server build failed"
  }
}
finally {
  Pop-Location
}
