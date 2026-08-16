# Copies the just-built NSIS installer into releases/<version>/ and upserts
# releases/latest.json. Never deletes another version's directory. Installer
# binaries stay out of git; the index, notes, and SHA-256 sums are tracked.
param(
    [string]$Version = "",
    [string]$NotesZh = "",
    [string]$NotesEn = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tauriConf = Get-Content -Raw -LiteralPath (Join-Path $root "src-tauri\tauri.conf.json") | ConvertFrom-Json
if (-not $Version) { $Version = [string]$tauriConf.version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "refusing to publish a non-semver desktop version: $Version"
}

$nsisName = "DeepSeek Harness_${Version}_x64-setup.exe"
$nsisSource = Join-Path $root "src-tauri\target\release\bundle\nsis\$nsisName"
if (-not (Test-Path -LiteralPath $nsisSource)) {
    throw "NSIS installer not found: $nsisSource"
}

$destDir = Join-Path $root "releases\$Version"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$destExe = Join-Path $destDir $nsisName
Copy-Item -LiteralPath $nsisSource -Destination $destExe -Force

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destExe).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $destExe).Length
$sums = Join-Path $destDir "SHA256SUMS"
Set-Content -LiteralPath $sums -Value "$hash  $nsisName`n" -NoNewline
Add-Content -LiteralPath $sums -Value ""

$full = (Resolve-Path -LiteralPath $destExe).Path
$url = "file:///" + ($full -replace '\\', '/')
$releasedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")

$indexPath = Join-Path $root "releases\latest.json"
if (Test-Path -LiteralPath $indexPath) {
    $index = Get-Content -Raw -LiteralPath $indexPath | ConvertFrom-Json
} else {
    $index = [pscustomobject]@{
        schemaVersion = 1
        channel = "stable"
        latest = $Version
        releases = @()
    }
}

if (-not $NotesZh -or -not $NotesEn) {
    $existing = @($index.releases) | Where-Object { $_.version -eq $Version } | Select-Object -First 1
    if ($existing -and $existing.notes) {
        if (-not $NotesZh) { $NotesZh = [string]$existing.notes.zh }
        if (-not $NotesEn) { $NotesEn = [string]$existing.notes.en }
    }
}
if (-not $NotesZh) { $NotesZh = "DeepSeek Harness 桌面 $Version。" }
if (-not $NotesEn) { $NotesEn = "DeepSeek Harness desktop $Version." }

$entry = [pscustomobject]@{
    version = $Version
    releasedAt = $releasedAt
    notes = [pscustomobject]@{ zh = $NotesZh; en = $NotesEn }
    artifacts = [pscustomobject]@{
        "windows-x64" = [pscustomobject]@{
            kind = "nsis"
            filename = $nsisName
            url = $url
            sha256 = $hash
            size = $size
        }
    }
}

$kept = @(@($index.releases) | Where-Object { $_.version -ne $Version })
$index.releases = @($entry) + $kept
$index.latest = $Version
$index.schemaVersion = 1
if (-not $index.channel) { $index.channel = "stable" }

$json = $index | ConvertTo-Json -Depth 8
Set-Content -LiteralPath $indexPath -Value ($json.TrimEnd() + "`n") -Encoding utf8
Write-Host "published $Version -> $destExe"
Write-Host "sha256 $hash"
Write-Host "index $indexPath"
