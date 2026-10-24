param(
    [string]$ProjectDataRoot = "",
    [string]$PythonExecutable = "",
    [string]$BindAddress = "127.0.0.1",
    [int]$Port = 8000,
    [switch]$NoBrowser,
    [switch]$Reinstall
)

$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$BackendDir = Join-Path $RootDir "src\backend"
$FrontendDist = Join-Path $RootDir "src\frontend\dist"
$Requirements = Join-Path $BackendDir "requirements.txt"
$VenvDir = Join-Path $RootDir ".venv-local"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$RequirementsMarker = Join-Path $VenvDir ".requirements.sha256"
$LocalDataRoot = Join-Path $RootDir "local_data"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-Python {
    if ($PythonExecutable) {
        $resolved = (Resolve-Path -LiteralPath $PythonExecutable -ErrorAction Stop).Path
        return $resolved
    }
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        $candidate = (& py -3.11 -c "import sys; print(sys.executable)" 2>$null)
        if ($LASTEXITCODE -eq 0 -and $candidate) {
            return $candidate.Trim()
        }
    }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }
    throw "Python was not found. Install Python 3.10 or newer and enable the 'Add Python to PATH' option."
}

if (-not (Test-Path -LiteralPath $FrontendDist -PathType Container)) {
    throw "Built frontend not found: $FrontendDist. Download the release package from GitHub Releases instead of a source-only archive."
}

if (-not $ProjectDataRoot) {
    $ProjectDataRoot = Join-Path $RootDir "project_data"
}
if (-not (Test-Path -LiteralPath $ProjectDataRoot -PathType Container)) {
    throw "project_data was not found: $ProjectDataRoot. Generate it with the project_data pipeline, place it beside start_local.ps1, or pass -ProjectDataRoot <path>."
}
$ProjectDataRoot = (Resolve-Path -LiteralPath $ProjectDataRoot).Path
$ManifestPath = Join-Path $ProjectDataRoot "backend_ready\manifest.json"
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Invalid project_data package: missing $ManifestPath"
}
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$SqliteRelative = if ($Manifest.database -and $Manifest.database.sqlite) { [string]$Manifest.database.sqlite } else { "database/web_database.sqlite" }
$RequiredPaths = @(
    $SqliteRelative,
    [string]$Manifest.tree.tree_core_path
)
foreach ($Matrix in @($Manifest.matrices)) {
    if ($Matrix.matrix_path) { $RequiredPaths += [string]$Matrix.matrix_path }
}
foreach ($Relative in ($RequiredPaths | Where-Object { $_ } | Select-Object -Unique)) {
    $FullPath = Join-Path $ProjectDataRoot $Relative
    if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) {
        throw "Invalid project_data package: missing $FullPath"
    }
}

Write-Step "Preparing Python environment"
$SystemPython = Resolve-Python
& $SystemPython -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
if ($LASTEXITCODE -ne 0) {
    throw "Python 3.10 or newer is required. Current interpreter: $SystemPython"
}

$NeedInstall = $Reinstall -or -not (Test-Path -LiteralPath $VenvPython -PathType Leaf)
if (-not $NeedInstall) {
    $ExpectedHash = (Get-FileHash -LiteralPath $Requirements -Algorithm SHA256).Hash
    $InstalledHash = if (Test-Path -LiteralPath $RequirementsMarker) { (Get-Content -LiteralPath $RequirementsMarker -Raw).Trim() } else { "" }
    $NeedInstall = $ExpectedHash -ne $InstalledHash
}
if ($NeedInstall) {
    if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
        & $SystemPython -m venv $VenvDir
        if ($LASTEXITCODE -ne 0) { throw "Could not create the Python virtual environment." }
    }
    Write-Step "Installing backend dependencies (first run only)"
    & $VenvPython -m pip install --disable-pip-version-check -r $Requirements
    if ($LASTEXITCODE -ne 0) { throw "Backend dependency installation failed. Check network access and the Python installation." }
    (Get-FileHash -LiteralPath $Requirements -Algorithm SHA256).Hash | Set-Content -LiteralPath $RequirementsMarker -Encoding ASCII
}

Write-Step "Preparing local storage"
foreach ($Directory in @(
    $LocalDataRoot,
    (Join-Path $LocalDataRoot "saved_queries"),
    (Join-Path $LocalDataRoot "downloads\jobs"),
    (Join-Path $LocalDataRoot "downloads\temp"),
    (Join-Path $LocalDataRoot "downloads\archive"),
    (Join-Path $LocalDataRoot "downloads\logs")
)) {
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
}

$Listening = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($Listening.Count -gt 0) {
    throw "Port $Port is already in use. Stop the process using it or run with -Port <another-port>."
}

$env:WEB_SERVER_PROJECT_DATA_ROOT = $ProjectDataRoot
$env:WEB_SERVER_LOCAL_DATA_ROOT = $LocalDataRoot
$env:WEB_SERVER_FRONTEND_DIST_ROOT = $FrontendDist
$env:WEB_SERVER_CORS_ORIGINS = ConvertTo-Json -Compress @("http://127.0.0.1:$Port", "http://localhost:$Port")
$env:PYTHONUTF8 = "1"

$BrowserHost = if ($BindAddress -in @("0.0.0.0", "::")) { "127.0.0.1" } else { $BindAddress }
$Url = "http://$BrowserHost`:$Port/"
Write-Step "Starting GenomeFunctionLens Local"
Write-Host "URL:          $Url"
Write-Host "project_data: $ProjectDataRoot"
Write-Host "local_data:   $LocalDataRoot"
Write-Host "Press Ctrl+C to stop the server."
if (-not $NoBrowser) {
    Start-Process $Url | Out-Null
}

Push-Location $BackendDir
try {
    & $VenvPython -m uvicorn app.main:app --host $BindAddress --port $Port
}
finally {
    Pop-Location
}
