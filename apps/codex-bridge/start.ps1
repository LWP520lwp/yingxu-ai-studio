$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$codexBinary = Get-Command codex.exe,codex -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $codexBinary) { throw '请先安装 Codex CLI，并在终端执行 codex login。' }
$env:CODEX_BIN = $codexBinary.Source
node (Join-Path $bridgeRoot 'src/server.mjs')
