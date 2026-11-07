# Sirve la carpeta web/ en http://localhost:8123 y abre el navegador. Lo arranca "Abrir CamFX.bat".
# La cámara solo funciona en una página https o en localhost, no abriendo el HTML con doble clic.
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'web')) + [IO.Path]::DirectorySeparatorChar
$port = 8123
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css'
  '.wasm' = 'application/wasm'; '.json' = 'application/json'; '.webp' = 'image/webp'; '.png' = 'image/png'
}
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() } catch {
  # Ya hay uno abierto: basta con ir a él.
  Start-Process "http://localhost:$port/"
  exit
}
Write-Host ""
Write-Host "  CamFX esta abierto en http://localhost:$port"
Write-Host "  Cierra esta ventana cuando acabes."
Write-Host ""
Start-Process "http://localhost:$port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if (-not $path) { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
  } catch {
    # El navegador cortó la descarga: nada que hacer.
  } finally {
    try { $res.Close() } catch {}
  }
}
