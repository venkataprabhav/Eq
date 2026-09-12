# Universal EQ — install requirements, build the extension, start the API.
# From the repo root:
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
#
# The API is HTTP only. Open http://127.0.0.1:8787  (not https://)

$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
if (-not $Root) { $Root = Get-Location }
Set-Location $Root

$Port = 8787
$HealthUrl = "http://127.0.0.1:$Port/health"
$HomeUrl = "http://127.0.0.1:$Port/"
$ExtDir = Join-Path $Root "apps\chrome-extension"
$CargoHome = Join-Path $env:USERPROFILE ".cargo"
$CargoBin = Join-Path $CargoHome "bin"
$MingwBin = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
$TargetDir = Join-Path $Root "target-gnu"

function Write-Step($message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$MingwBin;$CargoBin;$machine;$user"
}

function Test-Cmd($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Install-Winget($id, $label) {
    if (-not (Test-Cmd "winget")) {
        throw "winget is not available. Install $label by hand, then re-run this script."
    }
    Write-Host "Installing $label ($id) via winget..."
    & winget install --id $id -e --accept-source-agreements --accept-package-agreements
    # 0 = installed, -1978335189 = already installed, -1978335212 = no newer version
    if ($LASTEXITCODE -notin 0, -1978335189, -1978335212) {
        throw "winget failed installing $label (exit $LASTEXITCODE)."
    }
    Refresh-Path
}

function Assert-Node {
    if (Test-Cmd "node") {
        $version = (node -v).TrimStart("v")
        $major = [int]($version.Split(".")[0])
        if ($major -eq 22) {
            Write-Host "Node $version already installed."
            return
        }
        Write-Host "Node $version found; this repo wants Node 22. Installing Node 22..."
    } else {
        Write-Host "Node not found."
    }
    Install-Winget "OpenJS.NodeJS.22" "Node.js 22"
    Refresh-Path
    if (-not (Test-Cmd "node")) {
        throw "Node was installed but is still not on PATH. Close this window, open a new terminal, and run start.ps1 again."
    }
}

function Assert-Rust {
    Refresh-Path
    if (-not (Test-Cmd "cargo") -or -not (Test-Cmd "rustup")) {
        Write-Host "Rust / Cargo not on PATH."
        Install-Winget "Rustlang.Rustup" "Rustup"
        Refresh-Path
    }
    if (-not (Test-Cmd "cargo")) {
        throw "Cargo is still missing. Install from https://rustup.rs/ then re-run this script in a new terminal."
    }
    Write-Host "$(cargo --version)"
}

function Assert-Mingw {
    Refresh-Path
    if (Test-Cmd "gcc") {
        Write-Host "gcc already on PATH."
        return
    }
    if (Test-Path (Join-Path $MingwBin "gcc.exe")) {
        Write-Host "Found WinLibs gcc at $MingwBin"
        Refresh-Path
        return
    }
    Write-Host "GNU linker (gcc) not found. Installing WinLibs MinGW..."
    Install-Winget "BrechtSanders.WinLibs.POSIX.UCRT" "WinLibs MinGW"
    Refresh-Path
    if (-not (Test-Cmd "gcc") -and -not (Test-Path (Join-Path $MingwBin "gcc.exe"))) {
        throw "gcc is still missing. The GNU Rust toolchain needs MinGW."
    }
}

function Assert-GnuToolchain {
    Refresh-Path
    rustup toolchain install stable-x86_64-pc-windows-gnu
    rustup target add x86_64-pc-windows-gnu --toolchain stable-x86_64-pc-windows-gnu
}

function Get-ListenerPid([int]$listenPort) {
    $conns = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { return $null }
    return ($conns | Select-Object -First 1).OwningProcess
}

function Test-ApiUp {
    try {
        $r = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
        return [bool]$r.ok
    } catch {
        return $false
    }
}

function Stop-OldApi {
    $pidOnPort = Get-ListenerPid $Port
    if (-not $pidOnPort) { return }
    $proc = Get-Process -Id $pidOnPort -ErrorAction SilentlyContinue
    if (-not $proc) { return }
    if ($proc.ProcessName -ne "universal-eq-api") {
        throw "Port $Port is in use by $($proc.ProcessName) (PID $pidOnPort). Stop that process and re-run."
    }
    Write-Host "Stopping old API PID $pidOnPort"
    Stop-Process -Id $pidOnPort -Force
    Start-Sleep -Seconds 1
}

Write-Host "Universal EQ setup"
Write-Host "Repo: $Root"

Write-Step "1/5  Requirements"
Refresh-Path
Assert-Node
Assert-Rust
Assert-Mingw
Assert-GnuToolchain
Refresh-Path

Write-Step "2/5  Chrome extension dependencies"
if (-not (Test-Path (Join-Path $ExtDir "package.json"))) {
    throw "Missing $ExtDir\package.json"
}
npm install --prefix $ExtDir

Write-Step "3/5  npm run build"
npm run build --prefix $ExtDir
Write-Host "Unpacked extension: $ExtDir\dist"
Write-Host "Load that folder in chrome://extensions (Developer mode → Load unpacked)."

Write-Step "4/5  Rust API (release)"
$env:CARGO_TARGET_DIR = $TargetDir
cargo +stable-x86_64-pc-windows-gnu build -p universal-eq-api --release

Write-Step "5/5  Start backend"
Stop-OldApi

$apiExe = Join-Path $TargetDir "release\universal-eq-api.exe"
if (-not (Test-Path $apiExe)) {
    throw "Build finished but $apiExe is missing."
}

Write-Host ""
Write-Host "API is HTTP only. Do not use https://" -ForegroundColor Yellow
Write-Host "  $HomeUrl"
Write-Host "  $HealthUrl"
Write-Host ""
Write-Host "If Chrome says ERR_SSL_PROTOCOL_ERROR, it upgraded the URL to https."
Write-Host "Turn off Settings → Privacy and security → Security → Always use secure connections"
Write-Host "or type the URL with http:// and click 'Continue to site' if asked."
Write-Host ""
Write-Host "Leave this window open. Ctrl+C stops the API."
Write-Host ""

& $apiExe
