# KnightCat Endless Run - yerel sunucu (internet gerekmez, kurulum gerekmez)
# Bu klasördeki dosyaları http://localhost adresinden sunar ve oyunu tarayıcıda açar.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$types = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.png'='image/png'; '.wasm'='application/wasm'; '.data'='application/octet-stream'
  '.tflite'='application/octet-stream'; '.binarypb'='application/octet-stream'; '.md'='text/plain; charset=utf-8'
}
$listener = $null; $port = 0
foreach ($p in 8080, 8081, 8090, 8765, 9000, 5500) {
  try { $l = New-Object System.Net.HttpListener; $l.Prefixes.Add("http://localhost:$p/"); $l.Start(); $listener = $l; $port = $p; break } catch { }
}
if (-not $listener) { Write-Host 'Bos port bulunamadi. Diger programlari kapatip tekrar deneyin.'; Read-Host 'Cikmak icin Enter'; exit 1 }
$url = "http://localhost:$port/index.html"
Write-Host ''
Write-Host '  KnightCat Endless Run calisiyor' -ForegroundColor Yellow
Write-Host "  Adres: $url"
Write-Host '  Oyunu kapatmak icin bu pencereyi kapatin.'
Write-Host ''
Start-Process $url
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext(); $res = $ctx.Response
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $res.AddHeader('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($full)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $res.StatusCode = 404 }
    $res.OutputStream.Close()
  } catch { }
}
