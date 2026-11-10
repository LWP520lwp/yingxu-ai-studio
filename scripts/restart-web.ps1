[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'common.ps1')
Import-WorkbenchEnvironment
$projectRoot = Get-WorkbenchProjectRoot
$runtimeRoot = Get-WorkbenchRuntimeRoot
$processFile = Join-Path $runtimeRoot 'dev-processes.json'
$parsedRecords = Get-Content -LiteralPath $processFile -Raw -Encoding UTF8 | ConvertFrom-Json
$records = @($parsedRecords | ForEach-Object { $_ })
$ports = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:WEB_PORT) -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$record = @($records | Where-Object { $_.name -eq 'web' -and [int]$_.pid -in $ports })
if ($record.Count -ne 1 -or $ports.Count -ne 1) { throw 'The configured frontend port does not have one tracked process.' }
$process = Get-Process -Id ([int]$record[0].pid) -ErrorAction Stop
if (-not (Test-WorkbenchTrackedProcess -Process $process -Record $record[0])) { throw 'The tracked frontend process identity does not match.' }
$command = (Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)").CommandLine
$vitePaths = @((Join-Path $projectRoot 'node_modules\vite\bin\vite.js'), (Join-Path $projectRoot 'apps\web\node_modules\vite\bin\vite.js'))
$viteBinary = $vitePaths | Where-Object { (Test-Path -LiteralPath $_) -and $command.Contains($_) } | Select-Object -First 1
if (-not $viteBinary) { throw 'The tracked process does not run this project Vite. No process was stopped.' }
$nodeBinary = $record[0].path
Stop-Process -Id $process.Id
$process.WaitForExit(10000) | Out-Null
if (Test-WorkbenchPort -Port ([int]$env:WEB_PORT)) { throw 'The frontend port is still occupied.' }
$env:VITE_API_TARGET = "http://127.0.0.1:$env:APP_PORT"
$logRoot = Join-Path $runtimeRoot 'logs'
$frontend = Start-Process -FilePath $nodeBinary -ArgumentList @("`"$viteBinary`"", '--host', '127.0.0.1', '--port', $env:WEB_PORT, '--strictPort') -WorkingDirectory (Join-Path $projectRoot 'apps\web') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'web.stdout.log') -RedirectStandardError (Join-Path $logRoot 'web.stderr.log')
$nextRecords = @($records | Where-Object { [int]$_.pid -ne [int]$record[0].pid }) + @(@{name='web';pid=$frontend.Id;startedAt=$frontend.StartTime.ToUniversalTime().ToString('o');path=$nodeBinary})
Write-WorkbenchUtf8 -Path $processFile -Content ($nextRecords | ConvertTo-Json -Depth 4)
Wait-WorkbenchPort -Port ([int]$env:WEB_PORT)
Write-Host "Frontend restarted on http://localhost:$env:WEB_PORT. API and infrastructure were kept running."
