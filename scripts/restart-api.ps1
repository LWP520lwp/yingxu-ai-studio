[CmdletBinding()]
param([switch]$SkipBuild)
. (Join-Path $PSScriptRoot 'common.ps1')
Import-WorkbenchEnvironment
$projectRoot = Get-WorkbenchProjectRoot
$runtimeRoot = Get-WorkbenchRuntimeRoot
$processFile = Join-Path $runtimeRoot 'dev-processes.json'
$records = @()
if (Test-Path -LiteralPath $processFile) {
    # ConvertFrom-Json returns a single System.Object[] for a top-level JSON
    # array. Pipe it through ForEach-Object so @(...) stores the records rather
    # than one nested array, which would make $record.pid an Object[] value.
    $records = @((Get-Content -LiteralPath $processFile -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_ })
}
$apiRecords = @($records | Where-Object { $_.name -eq 'api' })
if ($apiRecords.Count -gt 1) { throw 'Multiple tracked API records found; no process was stopped.' }
$record = $apiRecords | Select-Object -First 1
if (Test-WorkbenchPort -Port ([int]$env:APP_PORT)) {
    if (-not $record) { throw 'The API port is occupied without this runtime tracking record; no process was stopped.' }
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if (-not (Test-WorkbenchTrackedProcess -Process $process -Record $record)) {
        throw 'The tracked API process identity does not match; no process was stopped.'
    }
    $apiPortPids = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:APP_PORT) -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    if ($apiPortPids.Count -ne 1 -or [int]$apiPortPids[0] -ne [int]$process.Id) {
        throw 'The tracked API process does not uniquely own the configured API port; no process was stopped.'
    }
    $apiCommand = (Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction Stop).CommandLine
    $jarMatch = [regex]::Match($apiCommand, '(?i)(?:^|\s)-jar\s+(?:"([^"]+)"|(\S+))')
    $trackedJar = if ($jarMatch.Groups[1].Success) { $jarMatch.Groups[1].Value } else { $jarMatch.Groups[2].Value }
    $targetDirectory = [IO.Path]::GetFullPath((Join-Path $projectRoot 'apps\api\target'))
    if (-not $jarMatch.Success -or -not [IO.Path]::IsPathRooted($trackedJar) -or
        -not [string]::Equals([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($trackedJar)), $targetDirectory, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The tracked API command does not run this project target jar; no process was stopped.'
    }
    Stop-Process -Id $process.Id
    $process.WaitForExit(10000) | Out-Null
}
if (Test-WorkbenchPort -Port ([int]$env:APP_PORT)) { throw 'The API port is still occupied; no additional process will be stopped.' }

$apiRoot = Join-Path $projectRoot 'apps\api'
$javaBinary = Join-Path $env:JAVA_HOME 'bin\java.exe'
if (-not (Test-Path -LiteralPath $javaBinary)) { throw 'Portable Java is missing.' }
if (-not $SkipBuild) {
    Push-Location $apiRoot
    try {
        & $env:MAVEN_CMD --batch-mode -DskipTests package
        if ($LASTEXITCODE -ne 0) { throw 'API packaging failed. Frontend and infrastructure were left running.' }
    } finally { Pop-Location }
}
$jar = Get-ChildItem -LiteralPath (Join-Path $apiRoot 'target') -Filter '*.jar' |
    Where-Object { $_.Name -notmatch '(sources|javadoc|original)' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $jar) { throw 'No executable API jar found.' }
$logRoot = Join-Path $runtimeRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$api = Start-Process -FilePath $javaBinary -ArgumentList @('-jar', "`"$($jar.FullName)`"", "--server.port=$env:APP_PORT") -WorkingDirectory $apiRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'api.stdout.log') -RedirectStandardError (Join-Path $logRoot 'api.stderr.log')
$otherRecords = @($records | Where-Object { $_.name -ne 'api' })
$otherRecords += @{name='api';pid=$api.Id;startedAt=$api.StartTime.ToUniversalTime().ToString('o');path=$javaBinary}
Write-WorkbenchUtf8 -Path $processFile -Content (@($otherRecords) | ConvertTo-Json -Depth 4)
Wait-WorkbenchPort -Port ([int]$env:APP_PORT) -TimeoutSeconds 60
Write-Host "API restarted on http://localhost:$env:APP_PORT. Frontend and infrastructure were kept running."
