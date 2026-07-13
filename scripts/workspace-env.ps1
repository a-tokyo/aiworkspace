# Load parent-root .env.local into the current PowerShell session.
# Dot-sourced from profile via npm run mcp:install-shell.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path (Split-Path -Parent (Split-Path -Parent $ScriptDir)) ".env.local"
$PathsFile = Join-Path $ScriptDir ".mcp-env.paths"

if (-not (Test-Path $EnvFile)) { return }
if (-not (Test-Path $PathsFile)) { return }

$node = $null
Get-Content $PathsFile | ForEach-Object {
  if ($_ -match '^AIWORKSPACE_NODE=(.+)$') {
    $node = $matches[1].Trim().Trim('"')
  }
}
if (-not $node -or -not (Test-Path -LiteralPath $node)) { return }

$loader = Join-Path $ScriptDir "mcp-load-env.mjs"
$json = & $node $loader --dump-env $EnvFile 2>$null
if (-not $json) { return }

$envVars = $json | ConvertFrom-Json
foreach ($prop in $envVars.PSObject.Properties) {
  Set-Item -Path "env:$($prop.Name)" -Value $prop.Value
}
