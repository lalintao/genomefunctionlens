param(
    [string]$ProjectDataRoot = "",
    [string]$PythonExecutable = "",
    [string]$BindAddress = "127.0.0.1",
    [int]$Port = 8000,
    [switch]$NoBrowser,
    [switch]$Reinstall
)

$ErrorActionPreference = "Stop"
$ReleasesRoot = $PSScriptRoot
$Launcher = Join-Path $ReleasesRoot "web_sever_local_v1.0\start_local.ps1"
if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
    throw "Local web edition not found: $Launcher"
}

if (-not $ProjectDataRoot) {
    $Candidates = @(
        (Join-Path $ReleasesRoot "web_sever_local_v1.0\project_data"),
        (Join-Path $ReleasesRoot "project_data"),
        (Join-Path (Split-Path -Parent $ReleasesRoot) "project_data")
    )
    $ProjectDataRoot = $Candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -First 1
}

if (-not $ProjectDataRoot) {
    Write-Host "project_data was not found automatically." -ForegroundColor Yellow
    Write-Host "Generate it with project_data_pipeline_v1.1.0, or enter an existing project_data directory." -ForegroundColor Yellow
    $ProjectDataRoot = (Read-Host "project_data path").Trim().Trim('"')
}

if (-not $ProjectDataRoot) {
    throw "No project_data path was provided."
}

$Forward = @{
    ProjectDataRoot = $ProjectDataRoot
    BindAddress = $BindAddress
    Port = $Port
}
if ($PythonExecutable) { $Forward.PythonExecutable = $PythonExecutable }
if ($NoBrowser) { $Forward.NoBrowser = $true }
if ($Reinstall) { $Forward.Reinstall = $true }

& $Launcher @Forward
