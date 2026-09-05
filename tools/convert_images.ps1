# Converts Kayode's generated PNGs into the JPEGs the site serves.
# System.Drawing rather than a dependency: this repo has no build step and no
# node_modules, and the site is four static folders. Crop rectangle first, then
# a high quality bicubic resize, then a real JPEG encode with a quality value.

Add-Type -AssemblyName System.Drawing

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }

function Convert-Img {
  param(
    [string]$Src, [string]$Dst,
    [int]$Cx, [int]$Cy, [int]$Cw, [int]$Ch,
    [int]$OutW, [int]$Quality
  )
  $img = [System.Drawing.Image]::FromFile($Src)
  try {
    if ($Cw -le 0) { $Cw = $img.Width - $Cx }
    if ($Ch -le 0) { $Ch = $img.Height - $Cy }
    $outH = [int][math]::Round($Ch * $OutW / $Cw)
    $bmp = New-Object System.Drawing.Bitmap($OutW, $outH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $dest = New-Object System.Drawing.Rectangle 0, 0, $OutW, $outH
    $srcR = New-Object System.Drawing.Rectangle $Cx, $Cy, $Cw, $Ch
    $g.DrawImage($img, $dest, $srcR, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$Quality)
    $bmp.Save($Dst, $jpegCodec, $ep)
    $bmp.Dispose()
    $kb = [int]((Get-Item $Dst).Length / 1024)
    Write-Output ("  {0,-20} {1}x{2}  {3}KB" -f (Split-Path $Dst -Leaf), $OutW, $outH, $kb)
  }
  finally { $img.Dispose() }
}

$up = 'C:\Users\kaybe\.claude\uploads\264f602d-0dd8-4102-b7fd-498b3a3b3d83'
$out = 'C:\Users\kaybe\Downloads\Claude Code\web\img'

# Hero: shown as the right 62% of the hero band, and used as the sharing card.
Convert-Img "$up\b3e8577f-image.png" "$out\hero.jpg"    0 0 0 0 1600 84

# The three landscape workshops, at 1000 wide: the panels on Solutions draw
# them about 800 across, the tiles on the home page only 200.
Convert-Img "$up\099c6a37-image.png" "$out\tailors.jpg" 0 0 0 0 1000 84
Convert-Img "$up\7a52d842-image.png" "$out\shoes.jpg"   0 0 0 0 1000 84
Convert-Img "$up\0f888edd-image.png" "$out\bags.jpg"    0 0 0 0 1000 84

Convert-Img "$up\5df76480-image.png" "$out\haberdashery.jpg"  0 0 0 0 1000 84
Convert-Img "$up\5da8791e-image.png" "$out\madetomeasure.jpg" 0 0 0 0 1000 84
Convert-Img "$up\2fe125f0-image.png" "$out\readytowear.jpg"   0 0 0 0 1000 84

# The fabric shop is a portrait picture and every slot that uses it is
# landscape, so it is cropped to a band across the rolls and the swatch book
# rather than being squashed.
Convert-Img "$up\d09cb043-image.png" "$out\fabrics.jpg" 0 380 1145 800 1000 84

# The eighth tile: not a trade like the others but a shape of business, and the
# one the app is most differentiated on.
Convert-Img "$up\07d3347c-image.png" "$out\multilocation.jpg" 0 0 0 0 1000 84
