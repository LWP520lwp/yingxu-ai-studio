[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipInfra,
    [switch]$WithBrowserWorker,
    [switch]$WithCodexBridge,
    [int]$ApiPort = 0,
    [int]$FrontendPort = 0
)
. (Join-Path $PSScriptRoot 'common.ps1')

function Start-WorkbenchCodexBridge {
    param([string]$ProjectRoot, [string]$NodeBinary, [int]$WebPort)
    if (Test-WorkbenchPort -Port 4599) { throw 'Port 4599 is occupied; the existing service was kept running.' }
    $codexCommand = Get-Command codex.exe,codex -ErrorAction SilentlyContinue | Select-Object -First 1
    $codexPath = if ($env:CODEX_BIN) { $env:CODEX_BIN } elseif ($codexCommand) { $codexCommand.Source } else { $null }
    if (-not $codexPath) { throw 'Install Codex CLI and run codex login before enabling its bridge.' }

    # Capture startup output in memory. The per-process token is shown only in
    # this local terminal; it never enters log files or the process record.
    $launch = New-Object Diagnostics.ProcessStartInfo
    $launch.FileName = $NodeBinary
    $launch.Arguments = '"' + (Join-Path $ProjectRoot 'apps\codex-bridge\src\server.mjs') + '"'
    $launch.WorkingDirectory = $ProjectRoot
    $launch.UseShellExecute = $false
    $launch.CreateNoWindow = $true
    $launch.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $launch.RedirectStandardOutput = $true
    $launch.RedirectStandardError = $true
    $launch.EnvironmentVariables['CODEX_BIN'] = $codexPath
    $launch.EnvironmentVariables['CODEX_BRIDGE_PORT'] = '4599'
    $launch.EnvironmentVariables['CODEX_BRIDGE_ORIGINS'] = "http://localhost:$WebPort,http://127.0.0.1:$WebPort"
    $bridge = New-Object Diagnostics.Process
    $bridge.StartInfo = $launch
    $bridgeStarted = $false
    try {
        if (-not $bridge.Start()) { throw 'Codex bridge process did not start.' }
        $bridgeStarted = $true
        $bridgeToken = $null
        for ($lineIndex = 0; $lineIndex -lt 4; $lineIndex++) {
            $lineTask = $bridge.StandardOutput.ReadLineAsync()
            if (-not $lineTask.Wait(5000)) { throw 'Codex bridge startup timed out.' }
            $line = $lineTask.Result
            if ($null -eq $line) { throw 'Codex bridge exited during startup.' }
            if ($line -match '^Local session token: ([A-Za-z0-9_-]{43})$') { $bridgeToken = $Matches[1] }
        }
        if (-not $bridgeToken) { throw 'Codex bridge did not return a session token.' }
        Wait-WorkbenchPort -Port 4599 -TimeoutSeconds 5
        Write-Host 'Codex bridge: http://127.0.0.1:4599'
        Write-Host "Local session token: $bridgeToken"
        Write-Host 'Paste it into the canvas Codex panel. No generation starts until you submit a request.'
        $bridgeToken = $null
        return $bridge
    } catch {
        if ($bridgeStarted -and -not $bridge.HasExited) { $bridge.Kill(); $bridge.WaitForExit(2000) | Out-Null }
        $bridge.Dispose()
        throw
    }
}

$projectRoot = Get-WorkbenchProjectRoot
if (-not $SkipInfra) { & (Join-Path $PSScriptRoot 'start-infra.ps1') }
Import-WorkbenchEnvironment
if ($ApiPort -gt 0) { $env:APP_PORT = [string]$ApiPort }
if ($FrontendPort -gt 0) { $env:WEB_PORT = [string]$FrontendPort }
$env:FRONTEND_URL = "http://localhost:$env:WEB_PORT"
$env:VITE_API_TARGET = "http://127.0.0.1:$env:APP_PORT"
$env:JAVA_HOME = $env:JAVA_HOME.TrimEnd('/','\')
$javaBinary = Join-Path $env:JAVA_HOME 'bin\java.exe'
if (-not (Test-Path -LiteralPath $javaBinary)) {
    throw 'Portable Java is missing. Run scripts/install-java.ps1 first.'
}
if (-not (Test-Path -LiteralPath $env:MAVEN_CMD)) { throw 'MAVEN_CMD does not exist.' }
foreach ($port in @([int]$env:APP_PORT, [int]$env:WEB_PORT)) {
    if (Test-WorkbenchPort -Port $port) { throw "Port $port is already occupied. Existing processes will not be stopped. Use -ApiPort / -FrontendPort to choose free ports." }
}
$runtimeRoot = Get-WorkbenchRuntimeRoot
$logRoot = Join-Path $runtimeRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$apiRoot = Join-Path $projectRoot 'apps\api'
$webRoot = Join-Path $projectRoot 'apps\web'
$nodeBinary = (Get-Command node.exe -ErrorAction Stop).Source
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source

if (-not $SkipBuild) {
    Push-Location $apiRoot
    try {
        & $env:MAVEN_CMD --batch-mode -DskipTests package
        if ($LASTEXITCODE -ne 0) { throw 'API packaging failed.' }
    } finally { Pop-Location }
}
$jar = Get-ChildItem -LiteralPath (Join-Path $apiRoot 'target') -Filter '*.jar' |
    Where-Object { $_.Name -notmatch '(sources|javadoc|original)' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $jar) { throw 'No executable API jar found. Run start-dev.ps1 without -SkipBuild.' }
$rootViteBinary = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$workspaceViteBinary = Join-Path $webRoot 'node_modules\vite\bin\vite.js'
if (Test-Path -LiteralPath $rootViteBinary) {
    $viteBinary = $rootViteBinary
} elseif (Test-Path -LiteralPath $workspaceViteBinary) {
    $viteBinary = $workspaceViteBinary
} else {
    # npm workspaces use the root lockfile and hoist shared dependencies.
    # Never create an independent lockfile or install tree in apps/web.
    Push-Location $projectRoot
    try {
        if (Test-Path -LiteralPath (Join-Path $projectRoot 'package-lock.json')) { & $npmCommand ci } else { & $npmCommand install }
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    } finally { Pop-Location }
    if (Test-Path -LiteralPath $rootViteBinary) {
        $viteBinary = $rootViteBinary
    } elseif (Test-Path -LiteralPath $workspaceViteBinary) {
        $viteBinary = $workspaceViteBinary
    } else {
        throw 'Vite was not found after the root workspace dependency installation.'
    }
}

# The canvas is a separately bundled same-origin app, not a Vite source import.
# Rebuild on every launch (also with -SkipBuild, which skips Maven packaging)
# so a missing or stale public/canvas-engine directory cannot be served.
Push-Location $projectRoot
try {
    & $npmCommand run build:canvas
    if ($LASTEXITCODE -ne 0) { throw 'Canvas engine build failed. No application process was started. Check workspace dependencies and build errors.' }
} finally { Pop-Location }
if (-not (Test-Path -LiteralPath (Join-Path $webRoot 'public\canvas-engine\index.html') -PathType Leaf)) {
    throw 'Canvas engine build did not produce public/canvas-engine/index.html. No application process was started.'
}

$processFile = Join-Path $runtimeRoot 'dev-processes.json'
$existingRecords = @()
if (Test-Path -LiteralPath $processFile) {
    try {
        # Capture first so Windows PowerShell 5 enumerates individual JSON rows;
        # UTF8 preserves executable paths containing non-ASCII characters.
        $parsedRecords = Get-Content -LiteralPath $processFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $existingRecords = @($parsedRecords | Where-Object {
            $trackedProcess = Get-Process -Id ([int]$_.pid) -ErrorAction SilentlyContinue
            Test-WorkbenchTrackedProcess -Process $trackedProcess -Record $_
        })
    } catch {
        throw 'The application process record is invalid; no application process was started.'
    }
}
if ($WithBrowserWorker) {
    # Initialize/import settings before spawning Java so both processes share
    # the same bearer token. No browser window or profile is opened at startup.
    & (Join-Path $PSScriptRoot 'start-browser-worker.ps1')
    Import-WorkbenchEnvironment
    # Preserve explicit ports: importing the shared file must not undo CLI overrides.
    if ($ApiPort -gt 0) { $env:APP_PORT = [string]$ApiPort }
    if ($FrontendPort -gt 0) { $env:WEB_PORT = [string]$FrontendPort }
    $env:FRONTEND_URL = "http://localhost:$env:WEB_PORT"
    $env:VITE_API_TARGET = "http://127.0.0.1:$env:APP_PORT"
}
$processes = @()
try {
    $api = Start-Process -FilePath $javaBinary -ArgumentList @('-jar', "`"$($jar.FullName)`"", "--server.port=$env:APP_PORT") -WorkingDirectory $apiRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'api.stdout.log') -RedirectStandardError (Join-Path $logRoot 'api.stderr.log')
    $processes += @{name='api';pid=$api.Id;startedAt=$api.StartTime.ToUniversalTime().ToString('o');path=$javaBinary}
    Wait-WorkbenchPort -Port ([int]$env:APP_PORT) -TimeoutSeconds 60
    $frontend = Start-Process -FilePath $nodeBinary -ArgumentList @("`"$viteBinary`"", '--host', '127.0.0.1', '--port', $env:WEB_PORT, '--strictPort') -WorkingDirectory $webRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'web.stdout.log') -RedirectStandardError (Join-Path $logRoot 'web.stderr.log')
    $processes += @{name='web';pid=$frontend.Id;startedAt=$frontend.StartTime.ToUniversalTime().ToString('o');path=$nodeBinary}
    Wait-WorkbenchPort -Port ([int]$env:WEB_PORT)
    if ($WithCodexBridge) {
        try {
            $codexBridge = Start-WorkbenchCodexBridge -ProjectRoot $projectRoot -NodeBinary $nodeBinary -WebPort ([int]$env:WEB_PORT)
            $processes += @{name='codex-bridge';pid=$codexBridge.Id;startedAt=$codexBridge.StartTime.ToUniversalTime().ToString('o');path=$nodeBinary}
        } catch {
            Write-Warning "Codex bridge was not started: $($_.Exception.Message) API, Web, MySQL and Redis are unaffected."
        }
    }
} finally {
    if ($processes.Count -gt 0) {
        # Keep prior app records (including different-port dev instances) so a new
        # launch cannot make an already tracked process impossible to stop safely.
        $mergedRecords = @($existingRecords | Where-Object { $_.pid -notin $processes.pid }) + @($processes)
        Write-WorkbenchUtf8 -Path $processFile -Content (@($mergedRecords) | ConvertTo-Json -Depth 4)
    }
}
Write-Host "Frontend: http://localhost:$env:WEB_PORT"
Write-Host "API: http://localhost:$env:APP_PORT/api/bootstrap"
Write-Host "Logs: $logRoot"
if (-not $WithBrowserWorker) { Write-Host 'Browser worker was not started. Use -WithBrowserWorker or scripts/start-browser-worker.ps1 when needed.' }
if (-not $WithCodexBridge) { Write-Host 'Codex bridge was not started. Use -WithCodexBridge or npm run codex:bridge when needed.' }
Write-Host 'This is a local development server; no 5000-user capacity claim is implied.'
