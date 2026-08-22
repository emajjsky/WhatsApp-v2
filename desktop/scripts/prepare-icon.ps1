$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outputPath = Join-Path $PSScriptRoot '..\build\icon.ico'
$outputPath = [System.IO.Path]::GetFullPath($outputPath)
$pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAqElEQVR4nO2T2w2AIBAELcX+LNSytAE49nWaGC/xB4GZPWDb/iJrP4+r+l4Dt4mw4KiIC7ckUnBJAtlwVBEJBcyIyAJK0QJucrQTj6Snu5BOT3eBhbtzLYHE85QFRv/ZNTEBZLxNoGp1VABNiozHBZA7AAs4EhE4IzDbHJlTCqwkZpcPBS/hrsBqLSRQSbAwCT6SUNPKcPQ4WuEpCQvuiMTArEgb+LN1A/nLvdQMEJ6pAAAAAElFTkSuQmCC'
$sourceBytes = [Convert]::FromBase64String($pngBase64)
$sourceStream = [System.IO.MemoryStream]::new($sourceBytes)
$sourceImage = [System.Drawing.Image]::FromStream($sourceStream)
$iconBitmap = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$graphics.DrawImage($sourceImage, 0, 0, 256, 256)
$graphics.Dispose()
$pngStream = [System.IO.MemoryStream]::new()
$iconBitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()
$pngStream.Dispose()
$iconBitmap.Dispose()
$sourceImage.Dispose()
$sourceStream.Dispose()

$stream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Flush()

$buildPath = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Force -Path $buildPath | Out-Null
[System.IO.File]::WriteAllBytes($outputPath, $stream.ToArray())
$writer.Dispose()
$stream.Dispose()
Write-Output "Generated $outputPath"
