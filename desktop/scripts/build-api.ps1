param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path,
  [string]$OutputDir = (Resolve-Path "$PSScriptRoot/..").Path + "/runtime/api"
)

$ErrorActionPreference = "Stop"

$go = Join-Path $RepoRoot ".tools/go/bin/go.exe"
if (-not (Test-Path $go)) {
  throw "Go toolchain not found: $go"
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
