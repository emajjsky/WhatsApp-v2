$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$repoRoot = Resolve-RepoRoot
$composeFile = Join-Path $repoRoot "deploy/docker/docker-compose.all.yml"

if (-not (Test-Path $composeFile)) {
  throw "Compose file not found: $composeFile"
}

docker compose -f $composeFile down

