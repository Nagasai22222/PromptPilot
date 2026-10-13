Add-Type -AssemblyName System.Drawing

$iconSource = Get-ChildItem "C:\Users\ACER\.gemini\antigravity\brain\52ab1d94-42d3-4bd8-a003-ebce33a22929\promptpilot_icon_*.png" | Select-Object -First 1
$img = [System.Drawing.Image]::FromFile($iconSource.FullName)
$outDir = "d:\embedings\promptpilot\extension\icons"

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force }

$sizes = 16, 48, 128
foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($img, 0, 0, $s, $s)
    $g.Dispose()
    $outPath = Join-Path $outDir "icon$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Created $outPath"
}

$img.Dispose()
Write-Host "Done!"
