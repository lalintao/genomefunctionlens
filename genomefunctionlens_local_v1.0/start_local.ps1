param(
    [string]$ProjectDataRoot = "",
    [string]$PythonExecutable = "",
    [string]$BindAddress = "127.0.0.1",
    [int]$Port = 8000,
    [switch]$NoBrowser,
    [switch]$Reinstall
)

$ErrorActionPreference = "Stop"
$Target = Join-Path $PSScriptRoot "deploy\windows\start_local.ps1"
if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {
    throw "Deployment script not found: $Target"
}
& $Target @PSBoundParameters
