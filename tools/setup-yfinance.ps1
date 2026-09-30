$ErrorActionPreference = 'Stop'
$taskRepoRoot = Split-Path -Parent $PSScriptRoot
$taskEnvironmentPath = Join-Path $taskRepoRoot '.venv-yfinance'
python -m venv $taskEnvironmentPath
if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment' }
$taskPythonPath = Join-Path $taskEnvironmentPath 'Scripts\python.exe'
& $taskPythonPath -m pip install -r (Join-Path $taskRepoRoot 'data\requirements-yfinance.txt')
if ($LASTEXITCODE -ne 0) { throw 'yfinance installation failed' }
Write-Output "Ready: $taskPythonPath"
