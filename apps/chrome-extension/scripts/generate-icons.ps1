Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\public\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-EqIcon([int]$size, [string]$path) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(255, 16, 17, 20))

  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 24, 26, 31))
  $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 232, 165, 75))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 232, 165, 75), [Math]::Max(1, $size / 16))

  $inset = [int]($size * 0.08)
  $g.FillEllipse($bg, $inset, $inset, $size - 2 * $inset, $size - 2 * $inset)

  $points = @()
  $freqs = @(0.12, 0.24, 0.38, 0.5, 0.64, 0.76, 0.88)
  $gains = @(0.62, 0.38, 0.48, 0.55, 0.42, 0.32, 0.4)
  for ($i = 0; $i -lt $freqs.Length; $i++) {
    $x = [int]($size * $freqs[$i])
    $y = [int]($size * $gains[$i])
    $points += New-Object System.Drawing.Point ($x, $y)
  }
  $g.DrawLines($pen, $points)

  $dot = [Math]::Max(2, [int]($size / 12))
  foreach ($p in $points) {
    $g.FillEllipse($accent, $p.X - $dot / 2, $p.Y - $dot / 2, $dot, $dot)
  }

  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bitmap.Dispose()
  $bg.Dispose()
  $accent.Dispose()
  $pen.Dispose()
}

New-EqIcon 16 (Join-Path $outDir "icon16.png")
New-EqIcon 48 (Join-Path $outDir "icon48.png")
New-EqIcon 128 (Join-Path $outDir "icon128.png")
