# Set or clear Windows User env vars for Bearer MCP keys (no secrets on the command line).
param(
  [string]$EnvFile,
  [Parameter(Mandatory = $true)][string]$KeysCsv,
  [switch]$Clear
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$keys = $KeysCsv -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }

if ($Clear) {
  foreach ($key in $keys) {
    [Environment]::SetEnvironmentVariable($key, $null, 'User')
  }
  exit 0
}

if (-not $EnvFile) { exit 1 }

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { exit 1 }
$loader = Join-Path $ScriptDir "mcp-load-env.mjs"
$json = & $nodeCmd.Source $loader --dump-env $EnvFile 2>$null
if (-not $json) { exit 1 }

$envVars = $json | ConvertFrom-Json
foreach ($key in $keys) {
  $val = $envVars.$key
  if ($null -ne $val -and $val -ne '') {
    [Environment]::SetEnvironmentVariable($key, $val, 'User')
  }
}
