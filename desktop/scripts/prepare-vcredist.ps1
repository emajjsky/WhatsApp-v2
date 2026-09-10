param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path,
  [string]$RuntimeDir = (Resolve-Path "$PSScriptRoot/..").Path + "/runtime",
  [string]$VCRedistPath = "",
  [string]$VCRedistUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
)

$ErrorActionPreference = "Stop"

$cacheDir = Join-Path $RepoRoot ".cache/desktop"
$cacheFile = Join-Path $cacheDir "VC_redist.x64.exe"
$targetDir = Join-Path $RuntimeDir "prerequisites"
$targetFile = Join-Path $targetDir "VC_redist.x64.exe"

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$windowsSecurityModule = Join-Path $env:WINDIR "System32/WindowsPowerShell/v1.0/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"
if (Test-Path -LiteralPath $windowsSecurityModule) {
  Import-Module -Name $windowsSecurityModule -Force
}

function Test-VCRedist {
  param([string]$FilePath)

  if (-not (Test-Path -LiteralPath $FilePath)) {
    return $false
  }
  if ((Get-Item -LiteralPath $FilePath).Length -lt 10000000) {
    return $false
  }

  try {
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    if ($signature.Status -eq "Valid" -and $signature.SignerCertificate.Subject -match "Microsoft Corporation") {
      return $true
    }
  }
  catch {
    Write-Warning "Authenticode verification is unavailable; checking the signed file metadata instead."
  }

  $versionInfo = (Get-Item -LiteralPath $FilePath).VersionInfo
  return $versionInfo.CompanyName -eq "Microsoft Corporation" -and $versionInfo.ProductName -match "Visual C\+\+.*Redistributable"
}

if (-not [string]::IsNullOrWhiteSpace($VCRedistPath)) {
  if (-not (Test-VCRedist -FilePath $VCRedistPath)) {
    throw "The supplied Visual C++ Redistributable is missing or does not have a valid Microsoft signature."
  }
  Copy-Item -LiteralPath $VCRedistPath -Destination $cacheFile -Force
}

if (-not (Test-VCRedist -FilePath $cacheFile)) {
  $partialFile = "$cacheFile.partial"
  if (Test-Path -LiteralPath $partialFile) {
    Remove-Item -LiteralPath $partialFile -Force
  }

  Write-Host "Downloading Microsoft Visual C++ Redistributable..."
  & curl.exe -L --fail --retry 5 --retry-delay 3 --connect-timeout 30 -o $partialFile $VCRedistUrl
  if ($LASTEXITCODE -ne 0 -or -not (Test-VCRedist -FilePath $partialFile)) {
    if (Test-Path -LiteralPath $partialFile) {
      Remove-Item -LiteralPath $partialFile -Force
    }
    throw "Failed to download a valid Microsoft Visual C++ Redistributable."
  }
  Move-Item -LiteralPath $partialFile -Destination $cacheFile -Force
}

Copy-Item -LiteralPath $cacheFile -Destination $targetFile -Force
Write-Host "Visual C++ Redistributable prepared."
