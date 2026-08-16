# End-to-end verification of the built dsh-desktop app:
# 1. Launches the built exe (or an installed one).
# 2. Finds the node.exe child and the loopback port it serves.
# 3. Verifies the official UI (title + __DSH_BOOT__ injection) is reachable.
# 4. Closes the app window and verifies both processes terminate.
param(
    [string]$Exe = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $Exe) {
    $Exe = Join-Path $root "src-tauri\target\release\dsh-desktop.exe"
}
if (-not (Test-Path $Exe)) { throw "app exe not found: $Exe" }

Write-Host "launching $Exe ..."
$app = Start-Process -FilePath $Exe -PassThru
try {
    # 1. Wait for a node.exe child of the app process.
    $deadline = (Get-Date).AddSeconds(150)
    $child = $null
    while ((Get-Date) -lt $deadline -and -not $child) {
        Start-Sleep -Milliseconds 500
        $child = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
            Where-Object { $_.ParentProcessId -eq $app.Id } | Select-Object -First 1
        if (-not $child -and $app.HasExited) { throw "app exited before spawning the server (code $($app.ExitCode))" }
    }
    if (-not $child) { throw "timed out waiting for the node.exe server child" }
    Write-Host "server child pid: $($child.ProcessId)"

    # 2. Find the loopback LISTEN port owned by that child.
    $deadline = (Get-Date).AddSeconds(60)
    $port = $null
    while ((Get-Date) -lt $deadline -and -not $port) {
        Start-Sleep -Milliseconds 500
        $conn = Get-NetTCPConnection -State Listen -OwningProcess $child.ProcessId -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -First 1
        if ($conn) { $port = $conn.LocalPort }
    }
    if (-not $port) { throw "no loopback listen socket found on the server child" }
    Write-Host "server port: $port"

    # 3. Verify the official UI is served.
    $deadline = (Get-Date).AddSeconds(30)
    $ok = $false
    while ((Get-Date) -lt $deadline -and -not $ok) {
        Start-Sleep -Milliseconds 500
        try {
            $html = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 10).Content
            $ok = $html -match '__DSH_BOOT__'
        } catch {}
    }
    if (-not $ok) { throw "served page does not carry __DSH_BOOT__" }
    $title = ([regex]::Match($html, '<title>([^<]*)</title>')).Groups[1].Value
    Write-Host "page title: $title"
    Write-Host ("__DSH_BOOT__ injected: " + ($html -match '__DSH_BOOT__'))
    Write-Host ("window title: " + $app.MainWindowTitle)
    if ($app.MainWindowTitle -notmatch 'DeepSeek') { throw "unexpected window title: $($app.MainWindowTitle)" }

    # 4. Close the window; app must exit and kill the server child.
    $childPid = $child.ProcessId
    $null = $app.CloseMainWindow()
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and -not $app.HasExited) { Start-Sleep -Milliseconds 500 }
    if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force; throw "app did not exit on window close" }
    Start-Sleep -Seconds 2
    $orphan = Get-Process -Id $childPid -ErrorAction SilentlyContinue
    if ($orphan) { Stop-Process -Id $childPid -Force; throw "server child survived app exit" }
    Write-Host "VERIFY OK: window served the official UI, clean shutdown, no orphan server"
} finally {
    if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.ParentProcessId -eq $app.Id } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
