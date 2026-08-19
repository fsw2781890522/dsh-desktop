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

    $nestedPatch = Join-Path $DshPackageRoot "node_modules\@deepseek-ai\dsh-web-app\cordis.patch.yml"
    $hoistedPatch = Join-Path (Split-Path $DshPackageRoot) "dsh-web-app\cordis.patch.yml"
    $webPatch = if (Test-Path -LiteralPath $nestedPatch) { $nestedPatch }
        elseif (Test-Path -LiteralPath $hoistedPatch) { $hoistedPatch }
        else { throw "web-app patch missing: $nestedPatch" }
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

function Read-FactoryWebPlugins {
    $manifest = Join-Path $root "factory\web-plugins.json"
    if (-not (Test-Path -LiteralPath $manifest)) {
        throw "factory web plugins missing: $manifest"
    }
    $parsed = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
    if (-not $parsed.packages) {
        throw "factory web plugins must list packages: $manifest"
    }
    return @($parsed.packages)
}

function Merge-MissingNodeModules {
    param(
        [Parameter(Mandatory = $true)][string]$SourceModules,
        [Parameter(Mandatory = $true)][string]$DestModules
    )
    New-Item -ItemType Directory -Force -Path $DestModules | Out-Null
    Get-ChildItem -LiteralPath $SourceModules -Force | ForEach-Object {
        if ($_.Name.StartsWith('.')) { return }
        $dest = Join-Path $DestModules $_.Name
        if ($_.Name.StartsWith('@') -and $_.PSIsContainer) {
            $scopeName = $_.Name
            New-Item -ItemType Directory -Force -Path $dest | Out-Null
            Get-ChildItem -LiteralPath $_.FullName | ForEach-Object {
                $childDest = Join-Path $dest $_.Name
                if (Test-Path -LiteralPath (Join-Path $childDest "package.json")) { return }
                if (Test-Path -LiteralPath $childDest) { Remove-Item -LiteralPath $childDest -Recurse -Force }
                Copy-Item -Recurse -LiteralPath $_.FullName -Destination $childDest
                Write-Host "factory plugin package: $scopeName/$($_.Name)"
            }
            return
        }
        if (Test-Path -LiteralPath (Join-Path $dest "package.json")) { return }
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
        Copy-Item -Recurse -LiteralPath $_.FullName -Destination $dest
        Write-Host "factory plugin package: $($_.Name)"
    }
}

function Install-FactoryWebPlugins {
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    $plugins = Read-FactoryWebPlugins
    $specs = @($plugins | ForEach-Object { "$($_.name)@$($_.spec)" })
    $scratch = Join-Path $env:TEMP "dsh-factory-web-plugins-$PID"
    New-Item -ItemType Directory -Force -Path $scratch | Out-Null
    try {
        Push-Location $scratch
        try {
            Write-Host ("npm install factory web plugins: " + ($specs -join ", "))
            npm install --no-audit --no-fund --loglevel=error @specs
            if ($LASTEXITCODE -ne 0) { throw "npm install of factory web plugins failed" }
        } finally {
            Pop-Location
        }
        $srcNm = Join-Path $scratch "node_modules"
        $destNm = Join-Path $RuntimeRoot "node_modules"
        if (-not (Test-Path -LiteralPath $srcNm)) {
            throw "factory web plugin install produced no node_modules"
        }
        Merge-MissingNodeModules -SourceModules $srcNm -DestModules $destNm
        $srcPty = Join-Path $srcNm "node-pty"
        $sidebarPty = Join-Path $destNm "dsh-better-sidebar\node_modules\node-pty"
        if (Test-Path -LiteralPath (Join-Path $srcPty "package.json")) {
            New-Item -ItemType Directory -Force -Path (Split-Path $sidebarPty) | Out-Null
            if (Test-Path -LiteralPath $sidebarPty) { Remove-Item -LiteralPath $sidebarPty -Recurse -Force }
            Copy-Item -Recurse -LiteralPath $srcPty -Destination $sidebarPty
            Write-Host "nested node-pty for dsh-better-sidebar -> $sidebarPty"
        }
    } finally {
        Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }

    foreach ($plugin in $plugins) {
        $pkgName = [string]$plugin.name
        $probe = if ($pkgName.StartsWith('@')) {
            Join-Path $RuntimeRoot ("node_modules\" + ($pkgName -replace '/', '\'))
        } else {
            Join-Path $RuntimeRoot "node_modules\$pkgName"
        }
        if (-not (Test-Path -LiteralPath (Join-Path $probe "package.json"))) {
            throw "factory web plugin missing after merge: $pkgName -> $probe"
        }
        $installed = Get-Content -Raw -LiteralPath (Join-Path $probe "package.json") | ConvertFrom-Json
        if ([string]$installed.version -ne [string]$plugin.spec) {
            throw "factory web plugin $pkgName version $($installed.version) != $($plugin.spec)"
        }
        if ($null -eq $installed.dsh.bundle.patch) {
            throw "factory web plugin $pkgName declares no dsh.bundle.patch"
        }
    }

    $ptyNode = Join-Path $RuntimeRoot "node_modules\dsh-better-sidebar\node_modules\node-pty\prebuilds\win32-x64\pty.node"
    if (-not (Test-Path -LiteralPath $ptyNode)) {
        $ptyNode = Join-Path $RuntimeRoot "node_modules\node-pty\prebuilds\win32-x64\pty.node"
    }
    if (-not (Test-Path -LiteralPath $ptyNode)) {
        throw "factory web plugins need a node-pty win32-x64 prebuild (nested under dsh-better-sidebar or hoisted)"
    }
    Write-Host "node-pty native: $ptyNode"

    $names = @($plugins | ForEach-Object { [string]$_.name })
    $listPath = Join-Path $RuntimeRoot "factory-web-plugins.json"
    $escaped = @($names | ForEach-Object { '"' + ($_ -replace '\\', '\\' -replace '"', '\"') + '"' })
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($listPath, ("[" + ($escaped -join ",") + "]`n"), $utf8)
    Write-Host "factory web plugin bundles: $($names -join ', ')"
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
        $srcNm = Join-Path $scratch "node_modules"
        $destNm = Join-Path $runtime "node_modules"
        Write-Host "copying npm node_modules into $destNm ..."
        if (Test-Path -LiteralPath $destNm) { Remove-Item -LiteralPath $destNm -Recurse -Force }
        robocopy $srcNm $destNm /E /MT:16 /NFL /NDL /NP /NJH /R:2 /W:2 | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
        if (-not (Test-Path -LiteralPath $dshRoot)) {
            throw "npm install did not produce $dshRoot"
        }
        $pkg = Get-Content (Join-Path $dshRoot "package.json") | ConvertFrom-Json
        Write-Host "bundled @deepseek-ai/dsh $($pkg.version)"
    } finally {
        Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
} elseif (-not (Test-Path -LiteralPath $dshRoot)) {
    throw "SkipNpm requires an existing runtime at $dshRoot"
}

# Official npm may hoist `commander` next to `@deepseek-ai/`. The 0.3.0
# completeness probe still looks under the dsh package; keep a nested copy
# so first launch does not fail closed after a hoist install.
$hoistedCommander = Join-Path $runtime "node_modules\commander"
$nestedCommander = Join-Path $dshRoot "node_modules\commander"
if (-not (Test-Path -LiteralPath (Join-Path $nestedCommander "package.json"))) {
    if (-not (Test-Path -LiteralPath (Join-Path $hoistedCommander "package.json"))) {
        throw "commander missing at $nestedCommander and $hoistedCommander"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $nestedCommander) | Out-Null
    Copy-Item -Recurse -LiteralPath $hoistedCommander -Destination $nestedCommander
    Write-Host "nested commander probe copy -> $nestedCommander"
}

# --- 3. Factory presets (shipped roster + default session preset) ---
Install-FactoryPresets $dshRoot

# --- 3b. Factory web plugins (profile bundles resolved from this tree) ---
Install-FactoryWebPlugins $runtime

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
