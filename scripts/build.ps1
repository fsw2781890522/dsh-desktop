# Builds the app with a Visual Studio C++ environment, regardless of whether
# the VS instance is discoverable through vswhere. Uses vcvars64.bat when the
# BuildTools layout exists, otherwise relies on ambient toolchain discovery.
param(
    [switch]$Debug,
    [string]$DshVersion = "0.1.1-rc.1",
    [string]$LocalHarnessRoot = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$zip = Join-Path $root "bundle-runtime.zip"
if (-not (Test-Path $zip)) {
    Write-Host "bundle-runtime.zip missing; packing the runtime first..."
    $bundleArgs = @("-DshVersion", $DshVersion)
    if ($LocalHarnessRoot) { $bundleArgs += @("-LocalHarnessRoot", $LocalHarnessRoot) }
    & (Join-Path $PSScriptRoot "bundle-runtime.ps1") @bundleArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$vcvars = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

# The bundler downloads NSIS from GitHub; use a mirror when the direct
# download is unreliable. Set TAURI_BUNDLER_TOOLS_GITHUB_MIRROR to "" to force
# direct GitHub.
if ($null -eq $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR) {
    $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR = "https://ghfast.top/https://github.com"
}

# Make sure cargo/rustc are reachable even when the ambient PATH lacks
# the rustup shim directory.
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path (Join-Path $cargoBin "cargo.exe")) -and ($env:PATH -notmatch [regex]::Escape($cargoBin))) {
    $env:PATH = "$cargoBin;$env:PATH"
}

if (Test-Path $vcvars) {
    Write-Host "Building inside vcvars64 environment..."
    $cmd = "`"$vcvars`" >nul && cd /d `"$root`" && npx tauri build"
    if ($Debug) { $cmd = "`"$vcvars`" >nul && cd /d `"$root`" && npx tauri build --debug" }
    cmd /c $cmd
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "No vcvars64.bat found; building with ambient environment..."
    Push-Location $root
    try {
        npx tauri build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
}
Write-Host "build finished"
if (-not $Debug) {
    Write-Host "publishing versioned installer into releases/..."
    & (Join-Path $PSScriptRoot "publish-release.ps1")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
