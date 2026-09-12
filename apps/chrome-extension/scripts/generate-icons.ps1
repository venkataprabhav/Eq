Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\public\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-EqIcon([int]$size, [string]$path) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::FromArgb(255, 11, 12, 15))

  $tile = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 22, 24, 31))
  $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 196, 165, 116))

  $inset = [int]($size * 0.06)
  $g.FillEllipse($tile, $inset, $inset, $size - 2 * $inset, $size - 2 * $inset)

  $heights = @(0.38, 0.62, 0.5, 0.32)
  $barW = [Math]::Max(2, [int]($size * 0.11))
  $gap = [int]($size * 0.055)
  $block = 4 * $barW + 3 * $gap
  $startX = [int](($size - $block) / 2)
  $base = [int]($size * 0.78)

  for ($i = 0; $i -lt $heights.Length; $i++) {
    $h = [int]($size * $heights[$i])
    $x = $startX + $i * ($barW + $gap)
    $y = $base - $h
    $g.FillRectangle($accent, $x, $y, $barW, $h)
  }

  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bitmap.Dispose()
  $tile.Dispose()
  $accent.Dispose()
}

New-EqIcon 16 (Join-Path $outDir "icon16.png")
New-EqIcon 48 (Join-Path $outDir "icon48.png")
New-EqIcon 128 (Join-Path $outDir "icon128.png")
