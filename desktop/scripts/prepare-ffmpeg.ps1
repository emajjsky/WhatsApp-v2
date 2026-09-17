param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path,
  [string]$RuntimeDir = (Resolve-Path "$PSScriptRoot/..").Path + "/runtime",
  [string]$FFmpegArchive = "",
  [string]$FFmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-16-19-44/ffmpeg-n8.1.2-53-g1005b294ff-win64-lgpl-shared-8.1.zip",
  [string]$FFmpegSha256 = "a654407793b1caef118550de3b99e46299dcabc6649ccf9a3a325f41ff4ea414"
)

$ErrorActionPreference = "Stop"

$archiveName = "ffmpeg-n8.1.2-53-g1005b294ff-win64-lgpl-shared-8.1.zip"
$cacheDir = Join-Path $RepoRoot ".cache/desktop"
$extractDir = Join-Path $cacheDir "ffmpeg-lgpl-extract"
$targetDir = Join-Path $RuntimeDir "ffmpeg"
$legalDir = Join-Path $RepoRoot "desktop/legal/ffmpeg"
$gplUrl = "https://raw.githubusercontent.com/FFmpeg/FFmpeg/1005b294ffdf1b4e75f58d7e98362f82462a6a61/COPYING.GPLv3"
$gplSha256 = "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903"
$lgplSha256 = "da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768"

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

if ([string]::IsNullOrWhiteSpace($FFmpegArchive)) {
  $FFmpegArchive = Join-Path $cacheDir $archiveName
}

function Test-FileHash {
  param(
    [string]$FilePath,
    [string]$ExpectedSha256
  )

  if (-not (Test-Path -LiteralPath $FilePath)) {
    return $false
  }
  $stream = [System.IO.File]::OpenRead($FilePath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha256.ComputeHash($stream)
    }
    finally {
      $sha256.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
  $actual = ([System.BitConverter]::ToString($hashBytes) -replace "-", "").ToLowerInvariant()
  return $actual -eq $ExpectedSha256.ToLowerInvariant()
}

function Get-VerifiedFile {
  param(
    [string]$Url,
    [string]$FilePath,
    [string]$ExpectedSha256
  )

  if (Test-FileHash -FilePath $FilePath -ExpectedSha256 $ExpectedSha256) {
    return
  }

  $partialFile = "$FilePath.partial"
  if (Test-Path -LiteralPath $partialFile) {
    Remove-Item -LiteralPath $partialFile -Force
  }

  Write-Host "Downloading verified FFmpeg LGPL runtime asset..."
  & curl.exe -L --fail --retry 10 --retry-all-errors --retry-delay 3 --connect-timeout 30 -o $partialFile $Url
  if ($LASTEXITCODE -ne 0 -or -not (Test-FileHash -FilePath $partialFile -ExpectedSha256 $ExpectedSha256)) {
    if (Test-Path -LiteralPath $partialFile) {
      Remove-Item -LiteralPath $partialFile -Force
    }
    throw "FFmpeg runtime download failed checksum verification."
  }

  Move-Item -LiteralPath $partialFile -Destination $FilePath -Force
}

Get-VerifiedFile -Url $FFmpegUrl -FilePath $FFmpegArchive -ExpectedSha256 $FFmpegSha256

$gplPath = Join-Path $cacheDir "FFmpeg-COPYING.GPLv3.txt"
Get-VerifiedFile -Url $gplUrl -FilePath $gplPath -ExpectedSha256 $gplSha256

if (Test-Path -LiteralPath $extractDir) {
  Remove-Item -LiteralPath $extractDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
Expand-Archive -LiteralPath $FFmpegArchive -DestinationPath $extractDir -Force

$ffmpegExe = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $ffmpegExe) {
  throw "FFmpeg archive is incomplete: ffmpeg.exe not found."
}

$sourceRoot = Split-Path (Split-Path $ffmpegExe.FullName -Parent) -Parent
$sourceBinDir = Join-Path $sourceRoot "bin"
$sourceLicense = Join-Path $sourceRoot "LICENSE.txt"
if (-not (Test-FileHash -FilePath $sourceLicense -ExpectedSha256 $lgplSha256)) {
  throw "FFmpeg LGPL license is missing or does not match the pinned source revision."
}

$licenseOutput = (& $ffmpegExe.FullName -hide_banner -L 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $licenseOutput -notmatch "GNU Lesser General Public License") {
  throw "The selected FFmpeg runtime does not identify itself as an LGPL build."
}

$versionOutput = (& $ffmpegExe.FullName -hide_banner -version 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch "n8\.1\.2-53-g1005b294ff" -or $versionOutput -notmatch "--enable-shared" -or $versionOutput -notmatch "--disable-static") {
  throw "The selected FFmpeg runtime version or linkage does not match the pinned LGPL shared build."
}
if ($versionOutput -match "--enable-gpl" -or $versionOutput -match "--enable-nonfree") {
  throw "The selected FFmpeg runtime unexpectedly enables GPL or non-free components."
}

$encoderOutput = (& $ffmpegExe.FullName -hide_banner -encoders 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $encoderOutput -notmatch "libopus") {
  throw "The selected FFmpeg runtime does not provide the required libopus encoder."
}

if (Test-Path -LiteralPath $targetDir) {
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

Copy-Item -LiteralPath $ffmpegExe.FullName -Destination (Join-Path $targetDir "ffmpeg.exe")
Get-ChildItem -LiteralPath $sourceBinDir -Filter "*.dll" -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetDir $_.Name)
}
Copy-Item -LiteralPath $sourceLicense -Destination (Join-Path $targetDir "COPYING.LGPLv3.txt")
Copy-Item -LiteralPath $gplPath -Destination (Join-Path $targetDir "COPYING.GPLv3.txt")
Copy-Item -LiteralPath (Join-Path $legalDir "NOTICE.txt") -Destination (Join-Path $targetDir "NOTICE.txt")
$versionOutput | Set-Content -LiteralPath (Join-Path $targetDir "BUILD-CONFIGURATION.txt") -Encoding UTF8

$preparedFFmpeg = Join-Path $targetDir "ffmpeg.exe"
$preparedLicense = (& $preparedFFmpeg -hide_banner -L 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $preparedLicense -notmatch "GNU Lesser General Public License") {
  throw "Prepared FFmpeg LGPL runtime cannot start with its packaged shared libraries."
}

Write-Host "FFmpeg LGPL shared runtime prepared and verified."
