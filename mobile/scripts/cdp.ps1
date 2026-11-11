# 앱 WebView 에서 자바스크립트 한 줄을 실행하고 결과(JSON)를 찍는다 — emu.sh js 가 쓴다(디버그 빌드만, 2026-11-09)
# ⚠️ 이 파일은 UTF-8 **BOM** 으로 저장한다 — 윈도우 PowerShell 5.1 은 BOM 없는 파일을 cp949 로 읽어 한글 주석이 깨지고 식이 엉뚱하게 넘어갔다
# adb forward 로 열어 둔 DevTools 포트(127.0.0.1)는 윈도우 쪽에서만 닿는다 — 그래서 WSL 이 아니라 여기서 붙는다.
param([string]$ExprFile, [int]$Port = 9333)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
# Get-Content 는 문자열에 PSPath 같은 속성을 붙여 ConvertTo-Json 이 객체로 내보낸다 → 순수 문자열로 읽는다
$expr = [IO.File]::ReadAllText($ExprFile, [Text.Encoding]::UTF8)
$targets = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/json").Content | ConvertFrom-Json
$page = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $ct).Wait()
$msg = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $expr; awaitPromise = $true; returnByValue = $true } } | ConvertTo-Json -Compress -Depth 5
$bytes = [Text.Encoding]::UTF8.GetBytes($msg)
$ws.SendAsync((New-Object 'ArraySegment[byte]' -ArgumentList (,$bytes)), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
$buf = New-Object byte[] 4194304
$sb = New-Object Text.StringBuilder
do {
  $seg = New-Object 'ArraySegment[byte]' -ArgumentList (,$buf)
  $r = $ws.ReceiveAsync($seg, $ct).Result
  [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
} while (-not $r.EndOfMessage)
$ws.Dispose()
Write-Output $sb.ToString()
