# Genera los logos y mosaicos del paquete de Microsoft Store (build/appx) a partir de build/icon.png.
# electron-builder los copia tal cual al .appx; si faltan, usaría sus iconos de ejemplo.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/generate-appx-assets.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'build\icon.png'
$outDir = Join-Path $root 'build\appx'
New-Item -ItemType Directory -Force $outDir | Out-Null

# Nombre, ancho, alto y tamaño del icono dentro del lienzo (fondo transparente).
$assets = @(
  @{ Name = 'StoreLogo.png';         W = 50;  H = 50;  Icon = 50 },
  @{ Name = 'Square44x44Logo.png';   W = 44;  H = 44;  Icon = 44 },
  @{ Name = 'SmallTile.png';         W = 71;  H = 71;  Icon = 50 },
  @{ Name = 'Square150x150Logo.png'; W = 150; H = 150; Icon = 100 },
  @{ Name = 'Wide310x150Logo.png';   W = 310; H = 150; Icon = 100 },
  @{ Name = 'LargeTile.png';         W = 310; H = 310; Icon = 200 }
)

$img = [System.Drawing.Image]::FromFile($source)
try {
  foreach ($a in $assets) {
    $bmp = New-Object System.Drawing.Bitmap $a.W, $a.H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $x = [int](($a.W - $a.Icon) / 2)
      $y = [int](($a.H - $a.Icon) / 2)
      $g.DrawImage($img, $x, $y, $a.Icon, $a.Icon)
      $bmp.Save((Join-Path $outDir $a.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $g.Dispose()
      $bmp.Dispose()
    }
    Write-Host "  $($a.Name) ($($a.W)x$($a.H))"
  }
} finally {
  $img.Dispose()
}
