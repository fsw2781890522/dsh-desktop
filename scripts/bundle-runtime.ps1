# Copies a standalone node.exe and the official published @deepseek-ai/dsh
# npm package into bundle-runtime/, overlays factory agent presets, then packs
# bundle-runtime.zip for the installer.
param(
    # dsh package version to install (published on npm).
    [string]$DshVersion = "latest",
    # Source node.exe to copy (must be Node >= 22.19 or >= 24).
    [string]$NodeExe = "",
    # Skip npm install + node.exe copy; overlay factory presets onto an
    # existing bundle-runtime and re-pack the zip.
    [switch]$SkipNpm
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root "bundle-runtime"
$dshRoot = Join-Path $runtime "node_modules\@deepseek-ai\dsh"

function Install-FactoryPresets {
    param([Parameter(Mandatory = $true)][string]$DshPackageRoot)

    $factoryRoot = Join-Path $root "factory\agent-presets"
    if (-not (Test-Path -LiteralPath $factoryRoot)) {
        throw "factory presets missing: $factoryRoot"
    }
    $shipped = Join-Path $DshPackageRoot "config\agent-presets"
    if (-not (Test-Path -LiteralPath $shipped)) {
        throw "shipped preset root missing: $shipped"
    }
    $factoryCustomRoot = Join-Path $DshPackageRoot "config\agent-presets-custom"
    $factoryCustomIds = @("anchored-standard")
    Get-ChildItem -LiteralPath $factoryRoot -Directory | ForEach-Object {
        $isFactoryCustom = $factoryCustomIds -contains $_.Name
        $destinationRoot = if ($isFactoryCustom) { $factoryCustomRoot } else { $shipped }
        if (-not (Test-Path -LiteralPath $destinationRoot)) {
            New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
        }
        $dest = Join-Path $destinationRoot $_.Name
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
        Copy-Item -Recurse -LiteralPath $_.FullName -Destination $dest
        if ($isFactoryCustom) {
            # Remove the old system-root copy left by 0.2.2 and earlier
            # bundles; otherwise discovery would win it before the custom
            # root and the preset would stay in the Built-in section.
            $legacyDest = Join-Path $shipped $_.Name
            if (Test-Path -LiteralPath $legacyDest) {
                Remove-Item -LiteralPath $legacyDest -Recurse -Force
            }
        }
        $composition = Join-Path $dest "agent.cordis.yml"
        if (-not (Test-Path -LiteralPath $composition)) {
            throw "factory preset $($_.Name) has no agent.cordis.yml"
        }
        $trustLabel = if ($isFactoryCustom) { "custom" } else { "system" }
        Write-Host "factory preset ($trustLabel): $($_.Name) -> $dest"
    }

    $webPatch = Join-Path $DshPackageRoot "node_modules\@deepseek-ai\dsh-web-app\cordis.patch.yml"
    if (-not (Test-Path -LiteralPath $webPatch)) {
        throw "web-app patch missing: $webPatch"
    }
    $text = [System.IO.File]::ReadAllText($webPatch)
    $updated = [regex]::Replace($text, '(?m)^(\s+default: )standard(?=\r?$)', '${1}anchored-standard')
    if ($updated -notmatch '(?m)^\s+default: anchored-standard\s*$') {
        throw "failed to set factory default preset in $webPatch"
    }
    if ($updated -ne $text) {
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($webPatch, $updated, $utf8)
        Write-Host "factory default session preset: anchored-standard"
    } else {
        Write-Host "factory default session preset already anchored-standard"
    }
}

New-Item -ItemType Directory -Force -Path $runtime | Out-Null

if (-not $SkipNpm) {
    # --- 1. Resolve node.exe ---
    if (-not $NodeExe) {
        $cmd = Get-Command node -ErrorAction SilentlyContinue
        if (-not $cmd) { throw "node.exe not found on PATH; pass -NodeExe <path>" }
        $NodeExe = $cmd.Source
    }
    $nodeVersion = & $NodeExe --version
    Write-Host "node: $NodeExe ($nodeVersion)"
    Copy-Item $NodeExe (Join-Path $runtime "node.exe") -Force

    # --- 2. Install the dsh package into a scratch dir and copy it in ---
    $scratch = Join-Path $env:TEMP "dsh-bundle-$PID"
    New-Item -ItemType Directory -Force -Path $scratch | Out-Null
    try {
        Push-Location $scratch
        try {
            Write-Host "npm install @deepseek-ai/dsh@$DshVersion ..."
            npm install --no-audit --no-fund --loglevel=error "@deepseek-ai/dsh@$DshVersion"
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        } finally {
            Pop-Location
        }
        $src = Join-Path $scratch "node_modules\@deepseek-ai\dsh"
        Write-Host "copying dsh package into $dshRoot ..."
        if (Test-Path -LiteralPath $dshRoot) { Remove-Item -LiteralPath $dshRoot -Recurse -Force }
        robocopy $src $dshRoot /E /MT:16 /NFL /NDL /NP /NJH /R:2 /W:2 | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
        $pkg = Get-Content (Join-Path $dshRoot "package.json") | ConvertFrom-Json
        Write-Host "bundled @deepseek-ai/dsh $($pkg.version)"
    } finally {
        Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
} elseif (-not (Test-Path -LiteralPath $dshRoot)) {
    throw "SkipNpm requires an existing runtime at $dshRoot"
}

# --- 3. Factory presets (shipped roster + default session preset) ---
Install-FactoryPresets $dshRoot

# --- 4. Smoke check: the bundled runtime must answer dsh --version ---
& (Join-Path $runtime "node.exe") (Join-Path $dshRoot "lib\bin.js") --version
if ($LASTEXITCODE -ne 0) { throw "bundled runtime failed its version smoke check" }

# --- 5. Pack a single zip for the NSIS installer ---
# Shipping ~33k node_modules files as individual Tauri/NSIS resources
# truncates the install (observed: tree stops mid-@opentelemetry, so
# `commander` never lands and `dsh web` dies with ERR_MODULE_NOT_FOUND).
# Compress-Archive hits MAX_PATH on this tree; Windows tar.exe does not.
$zip = Join-Path $root "bundle-runtime.zip"
Write-Host "creating $zip ..."
if (Test-Path $zip) { Remove-Item $zip -Force }
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw "tar.exe not found; it is required to pack bundle-runtime.zip"
}
& tar.exe -a -c -f $zip -C $runtime .
if ($LASTEXITCODE -ne 0) { throw "tar failed to create bundle-runtime.zip" }
Write-Host ("bundle-runtime.zip {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))
Write-Host "bundle-runtime ready"
