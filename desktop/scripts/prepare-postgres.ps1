param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path,
  [string]$RuntimeDir = (Resolve-Path "$PSScriptRoot/..").Path + "/runtime",
  [string]$PostgresArchive = "",
  [string]$PostgresUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.13-1-windows-x64-binaries.zip"
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

if ([string]::IsNullOrWhiteSpace($PostgresArchive)) {
  $PostgresArchive = Join-Path $cacheDir "postgresql-16.13-1-windows-x64-binaries.zip"
}

function Invoke-DownloadWithRetry {
  param(
    [string]$Url,
    [string]$OutFile,
    [int]$Attempts = 4
  )

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $partialFile = "$OutFile.partial"
  $curl = Get-Command "curl.exe" -ErrorAction SilentlyContinue

  if ($curl) {
    Write-Host "Downloading PostgreSQL runtime with curl..."
    & $curl.Source -L --fail --retry 8 --retry-delay 5 --connect-timeout 30 -C - -o $partialFile $Url
    if ($LASTEXITCODE -eq 0 -and (Test-Path $partialFile)) {
      $downloaded = (Get-Item -LiteralPath $partialFile).Length
      if ($downloaded -ge 50000000) {
        Move-Item -LiteralPath $partialFile -Destination $OutFile -Force
        return
      }
    }
    if (Test-Path $partialFile) {
      Remove-Item -LiteralPath $partialFile -Force
    }
  }

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    if (Test-Path $partialFile) {
      Remove-Item -LiteralPath $partialFile -Force
    }

    try {
      Write-Host "Downloading PostgreSQL runtime ($attempt/$Attempts)..."
      Invoke-WebRequest -Uri $Url -OutFile $partialFile
      if (-not (Test-Path $partialFile)) {
        throw "download did not create a file"
      }
      $downloaded = (Get-Item -LiteralPath $partialFile).Length
      if ($downloaded -lt 50000000) {
        throw "downloaded file is too small: $downloaded bytes"
      }
      Move-Item -LiteralPath $partialFile -Destination $OutFile -Force
      return
    }
    catch {
      if ($attempt -eq $Attempts) {
        throw
      }
      Start-Sleep -Seconds (3 * $attempt)
    }
  }
}

if (-not (Test-Path $PostgresArchive)) {
  Invoke-DownloadWithRetry -Url $PostgresUrl -OutFile $PostgresArchive
}

if (Test-Path $postgresDir) {
  Remove-Item -LiteralPath $postgresDir -Recurse -Force
}

$extractDir = Join-Path $cacheDir "postgresql-runtime-extract"
if (Test-Path $extractDir) {
  Remove-Item -LiteralPath $extractDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

Expand-Archive -LiteralPath $PostgresArchive -DestinationPath $extractDir -Force

$postgresExe = Get-ChildItem -Path $extractDir -Recurse -Filter "postgres.exe" | Select-Object -First 1
if (-not $postgresExe) {
  throw "PostgreSQL archive is incomplete: postgres.exe not found."
}

$sourceRoot = Split-Path (Split-Path $postgresExe.FullName -Parent) -Parent
New-Item -ItemType Directory -Force -Path $postgresDir | Out-Null
Copy-Item -Path (Join-Path $sourceRoot "*") -Destination $postgresDir -Recurse -Force

if (-not (Test-Path (Join-Path $postgresDir "bin/postgres.exe"))) {
  throw "PostgreSQL runtime is incomplete."
}
