[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='Medium')]
param()
. (Join-Path $PSScriptRoot 'common.ps1')
Import-WorkbenchEnvironment
$runtimeRoot = [IO.Path]::GetFullPath((Get-WorkbenchRuntimeRoot))
if ($runtimeRoot -notmatch '^[Ee]:[\\/].+') { throw 'WORKBENCH_RUNTIME_ROOT must be a dedicated absolute E: directory.' }
$processFile = Join-Path $runtimeRoot 'browser-worker-process.json'
if (-not (Test-Path -LiteralPath $processFile)) {
    Write-Host 'No tracked browser worker.'
    return
}
try { $record = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json } catch {
    throw 'The browser-worker process record is invalid; no process was stopped.'
}
$entryPoint = Join-Path (Get-WorkbenchProjectRoot) 'apps\browser-worker\src\server.mjs'
if ($record.name -ne 'browser-worker' -or $record.entryPoint -ne $entryPoint) {
    throw 'The process record does not belong to this browser worker; no process was stopped.'
}
$process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
if (-not $process) {
    Write-Host 'The tracked browser worker is no longer running.'
    return
}
if (-not (Test-WorkbenchTrackedProcess -Process $process -Record $record)) {
    throw 'The browser-worker PID no longer matches its recorded executable and start time; no process was stopped.'
}
if ($PSCmdlet.ShouldProcess("browser worker PID $($process.Id)", 'Stop the dedicated worker')) {
    Stop-Process -Id $process.Id
    $process.WaitForExit(10000) | Out-Null
    Write-Host 'Stopped the tracked browser worker. API, web, infrastructure and browser profile files were kept.'
}
