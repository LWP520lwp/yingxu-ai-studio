[CmdletBinding()]
param([switch]$WithBrowserWorker)
. (Join-Path $PSScriptRoot 'common.ps1')
Import-WorkbenchEnvironment
$processFile = Join-Path (Get-WorkbenchRuntimeRoot) 'dev-processes.json'
if (-not (Test-Path -LiteralPath $processFile)) {
    Write-Host 'No tracked application processes.'
    if ($WithBrowserWorker) { & (Join-Path $PSScriptRoot 'stop-browser-worker.ps1') }
    return
}
$records = @(Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json)
foreach ($record in $records) {
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if (Test-WorkbenchTrackedProcess -Process $process -Record $record) {
        if ($record.name -eq 'codex-bridge') {
            # Only this verified bridge's process tree: an active app-server
            # child must not survive after its local session token is retired.
            & taskkill.exe /PID $process.Id /T /F | Out-Null
            if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
                Write-Warning 'Unable to stop the tracked Codex bridge; inspect its process before retrying.'
                continue
            }
        } else {
            Stop-Process -Id $process.Id
        }
        Write-Host "Stopped tracked $($record.name) process."
    } else {
        Write-Warning "PID $($record.pid) no longer identifies the tracked process; it was not stopped."
    }
}
if ($WithBrowserWorker) {
    & (Join-Path $PSScriptRoot 'stop-browser-worker.ps1')
} else {
    Write-Host 'The separately tracked browser worker was kept running; use -WithBrowserWorker to stop it too.'
}
Write-Host 'Dedicated MySQL and Redis were kept running.'
