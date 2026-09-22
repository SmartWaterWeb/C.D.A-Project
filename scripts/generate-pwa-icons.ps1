Add-Type -AssemblyName System.Drawing

$iconDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null

foreach ($size in @(192, 512)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#0d3159'))
    $graphics.ScaleTransform($size / 512.0, $size / 512.0)

    $drop = New-Object System.Drawing.Drawing2D.GraphicsPath
    $drop.AddBezier(256, 91, 220, 145, 139, 232, 139, 313)
    $drop.AddBezier(139, 313, 139, 384, 191, 425, 256, 425)
    $drop.AddBezier(256, 425, 321, 425, 373, 384, 373, 313)
    $drop.AddBezier(373, 313, 373, 232, 292, 145, 256, 91)
    $drop.CloseFigure()

    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $graphics.FillPath($white, $drop)

    $wave = New-Object System.Drawing.Drawing2D.GraphicsPath
    $wave.AddBezier(178, 332, 215, 298, 242, 367, 286, 335)
    $wave.AddBezier(286, 335, 309, 318, 330, 320, 346, 330)
    $cyan = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#53bdf1'), 20)
    $cyan.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $cyan.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawPath($cyan, $wave)

    $outputPath = Join-Path $iconDirectory "icon-$size.png"
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $cyan.Dispose()
    $wave.Dispose()
    $white.Dispose()
    $drop.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
