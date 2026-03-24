param(
  [ValidateSet("", "daocloud")]
  [string]$Mirror = ""
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$repoRoot = Resolve-RepoRoot
$composeFile = Join-Path $repoRoot "deploy/docker/docker-compose.all.yml"

if (-not (Test-Path $composeFile)) {
  throw "Compose file not found: $composeFile"
}

if ($Mirror -eq "daocloud") {
  $env:DOCKER_IMAGE_PREFIX = "docker.m.daocloud.io/library/"
}

if (-not (Test-Path (Join-Path $repoRoot ".env"))) {
  throw "Missing .env at repo root. Create it from .env.example first: $repoRoot/.env"
}

docker compose -f $composeFile up -d --build

Write-Host ""
Write-Host "Services are up:"
Write-Host "  Web:         http://127.0.0.1:5173/"
Write-Host "  Go API:      http://127.0.0.1:8080/healthz"
Write-Host "  agent_runner:http://127.0.0.1:8090/healthz"
Write-Host ""

