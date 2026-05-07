param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path,
  [string]$RuntimeDir = (Resolve-Path "$PSScriptRoot/..").Path + "/runtime",
  [string]$PythonVersion = "3.12.10"
)

$ErrorActionPreference = "Stop"

$pythonDir = Join-Path $RuntimeDir "python"
$agentDir = Join-Path $RuntimeDir "agent_runner"
$cacheDir = Join-Path $RepoRoot ".cache/desktop"
$pythonZip = Join-Path $cacheDir "python-$PythonVersion-embed-amd64.zip"
$pythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

if (-not (Test-Path (Join-Path $pythonDir "python.exe"))) {
  if (-not (Test-Path $pythonZip)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonZip
  }
  if (Test-Path $pythonDir) {
    Remove-Item -LiteralPath $pythonDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null
  Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonDir -Force

  $pth = Get-ChildItem -Path $pythonDir -Filter "python*._pth" | Select-Object -First 1
  if ($pth) {
    $content = Get-Content -Path $pth.FullName
    if ($content -notcontains "..") {
      Add-Content -Path $pth.FullName -Value ".."
    }
  }
}

if (Test-Path $agentDir) {
  Remove-Item -LiteralPath $agentDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $agentDir | Out-Null
Copy-Item -Path (Join-Path $RepoRoot "agent_runner/*") -Destination $agentDir -Recurse -Force -Exclude "__pycache__"
