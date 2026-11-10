[CmdletBinding()]
param(
    # Used by start-dev before spawning the API; it does not start a process.
    [switch]$PrepareOnly
)
. (Join-Path $PSScriptRoot 'common.ps1')
$projectRoot = Get-WorkbenchProjectRoot
$environmentPath = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
    throw 'Missing .env.local. Run scripts/start-infra.ps1 first.'
}
if ((Get-Item -LiteralPath $environmentPath).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The local environment file must be a regular file, not a reparse point.'
}
Protect-WorkbenchPath -Path $environmentPath

function Test-WorkerSecretSettings {
    param([string]$Token, [string]$MasterKey)
    if ($Token -notmatch '^[\x21-\x7E]{32,}$') {
        throw 'BROWSER_WORKER_TOKEN must be an ASCII bearer secret of at least 32 characters. Existing values were not replaced.'
    }
    try { $decoded = [Convert]::FromBase64String($MasterKey) } catch {
        throw 'POOL_CREDENTIAL_MASTER_KEY must be a Base64-encoded 32-byte key. Existing values were not replaced.'
    }
    if ($decoded.Length -ne 32) {
        throw 'POOL_CREDENTIAL_MASTER_KEY must be a Base64-encoded 32-byte key. Existing values were not replaced.'
    }
}

function Get-WorkerEndpoint {
    param([string]$Url, [string]$Port)
    $uri = $null
    if ($Url -cnotmatch '\Ahttp://127\.0\.0\.1:[0-9]{4,5}/?\z' -or
        -not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/' -or
        $uri.Port -lt 1024 -or $uri.Port -gt 65535) {
        throw 'BROWSER_WORKER_URL must be an http://127.0.0.1 origin with a port from 1024 through 65535.'
    }
    $configuredPort = 0
    if ($Port -and (-not [int]::TryParse($Port, [ref]$configuredPort) -or $configuredPort -ne $uri.Port)) {
        throw 'BROWSER_WORKER_PORT must match the port in BROWSER_WORKER_URL. Existing settings were not changed.'
    }
    return $uri
}

# Lock read/append together: concurrent invocations must reuse the same generated secrets.
# Never rewrite existing lines or print the old/new values. A blank value is initialized
# by appending a value, using the existing environment loader's last-entry-wins behavior.
$stream = [IO.File]::Open($environmentPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
try {
    $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true, 4096, $true)
    try { $existingText = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $settings = @{}
    foreach ($line in ($existingText -split '\r?\n')) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
            throw 'Invalid environment file entry; use KEY=value without shell expressions.'
        }
        $settings[$Matches[1]] = $Matches[2]
    }
    $append = [ordered]@{}
    foreach ($key in @('BROWSER_WORKER_TOKEN', 'POOL_CREDENTIAL_MASTER_KEY', 'BROWSER_WORKER_URL', 'BROWSER_WORKER_PORT', 'BROWSER_INTERACTIVE_LOGIN_ENABLED')) {
        if (-not $settings.ContainsKey($key)) {
            $inheritedValue = [Environment]::GetEnvironmentVariable($key, 'Process')
            if ($inheritedValue) { $settings[$key] = $inheritedValue; $append[$key] = $inheritedValue }
        }
    }
    if ([string]::IsNullOrWhiteSpace($settings['BROWSER_WORKER_TOKEN'])) {
        $settings['BROWSER_WORKER_TOKEN'] = New-WorkbenchSecret
        $append['BROWSER_WORKER_TOKEN'] = $settings['BROWSER_WORKER_TOKEN']
    }
    if ([string]::IsNullOrWhiteSpace($settings['POOL_CREDENTIAL_MASTER_KEY'])) {
        $masterBytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($masterBytes) } finally { $rng.Dispose() }
        $settings['POOL_CREDENTIAL_MASTER_KEY'] = [Convert]::ToBase64String($masterBytes)
        $append['POOL_CREDENTIAL_MASTER_KEY'] = $settings['POOL_CREDENTIAL_MASTER_KEY']
    }
    Test-WorkerSecretSettings -Token $settings['BROWSER_WORKER_TOKEN'] -MasterKey $settings['POOL_CREDENTIAL_MASTER_KEY']
    if ([string]::IsNullOrWhiteSpace($settings['BROWSER_WORKER_URL'])) {
        $workerPort = if ($settings['BROWSER_WORKER_PORT']) { $settings['BROWSER_WORKER_PORT'] } else { '8091' }
        $settings['BROWSER_WORKER_URL'] = "http://127.0.0.1:$workerPort"
        $append['BROWSER_WORKER_URL'] = $settings['BROWSER_WORKER_URL']
    }
    $endpoint = Get-WorkerEndpoint -Url $settings['BROWSER_WORKER_URL'] -Port $settings['BROWSER_WORKER_PORT']
    if ([string]::IsNullOrWhiteSpace($settings['BROWSER_WORKER_PORT'])) {
        $settings['BROWSER_WORKER_PORT'] = [string]$endpoint.Port
        $append['BROWSER_WORKER_PORT'] = $settings['BROWSER_WORKER_PORT']
    }
    if ([string]::IsNullOrWhiteSpace($settings['BROWSER_INTERACTIVE_LOGIN_ENABLED'])) {
        $settings['BROWSER_INTERACTIVE_LOGIN_ENABLED'] = 'false'
        $append['BROWSER_INTERACTIVE_LOGIN_ENABLED'] = 'false'
    }
    if ($settings['BROWSER_INTERACTIVE_LOGIN_ENABLED'] -cnotin @('true', 'false')) {
        throw 'BROWSER_INTERACTIVE_LOGIN_ENABLED must be true or false. Existing settings were not changed.'
    }
    if ($append.Count -gt 0) {
        $prefix = if ($existingText.Length -gt 0 -and -not $existingText.EndsWith("`n")) { "`r`n" } else { '' }
        $lines = @('# Browser worker settings initialized by start-browser-worker.ps1; secret values are never printed.')
        foreach ($key in $append.Keys) { $lines += "$key=$($append[$key])" }
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($prefix + ($lines -join "`r`n") + "`r`n")
        $stream.Position = $stream.Length
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
} finally { $stream.Dispose() }
Import-WorkbenchEnvironment
$endpoint = Get-WorkerEndpoint -Url $env:BROWSER_WORKER_URL -Port $env:BROWSER_WORKER_PORT
Test-WorkerSecretSettings -Token $env:BROWSER_WORKER_TOKEN -MasterKey $env:POOL_CREDENTIAL_MASTER_KEY
if ($PrepareOnly) {
    Write-Host 'Local browser-worker settings are ready. Existing nonempty credentials were preserved.'
    return
}

function Get-WorkerEPath {
    param([string]$Value, [string]$Setting)
    if ($Value -notmatch '^[Ee]:[\\/].+') { throw "$Setting must be an absolute dedicated directory on E:." }
    $fullPath = [IO.Path]::GetFullPath($Value)
    if ($fullPath -notmatch '^[Ee]:[\\/].+' -or $fullPath.TrimEnd('\', '/') -eq 'E:') {
        throw "$Setting must be an absolute dedicated directory on E:."
    }
    $probe = $fullPath
    while ($probe) {
        $item = Get-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "$Setting must not pass through a reparse point."
        }
        $parent = [IO.Path]::GetDirectoryName($probe.TrimEnd('\', '/'))
        if ($parent -eq $probe) { break }
        $probe = $parent
    }
    return $fullPath
}

$runtimeRoot = Get-WorkerEPath -Value (Get-WorkbenchRuntimeRoot) -Setting 'WORKBENCH_RUNTIME_ROOT'
$workerRuntime = Get-WorkerEPath -Value (Join-Path $runtimeRoot 'browser-pool') -Setting 'Worker runtime'
$logRoot = Get-WorkerEPath -Value (Join-Path $runtimeRoot 'logs') -Setting 'Worker logs'
$env:BROWSER_PROFILE_ROOT = Get-WorkerEPath -Value $(if ($env:BROWSER_PROFILE_ROOT) { $env:BROWSER_PROFILE_ROOT } else { Join-Path $workerRuntime 'profiles' }) -Setting 'BROWSER_PROFILE_ROOT'
$env:PLAYWRIGHT_BROWSERS_PATH = Get-WorkerEPath -Value $(if ($env:PLAYWRIGHT_BROWSERS_PATH) { $env:PLAYWRIGHT_BROWSERS_PATH } else { Join-Path $workerRuntime 'browser-cache' }) -Setting 'PLAYWRIGHT_BROWSERS_PATH'
$env:npm_config_cache = Get-WorkerEPath -Value $(if ($env:npm_config_cache) { $env:npm_config_cache } else { Join-Path $workerRuntime 'npm-cache' }) -Setting 'npm_config_cache'
$env:TEMP = Get-WorkerEPath -Value (Join-Path $workerRuntime 'tmp') -Setting 'Worker temporary directory'
$env:TMP = $env:TEMP
foreach ($directory in @($runtimeRoot, $workerRuntime, $logRoot, $env:TEMP)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    Protect-WorkbenchPath -Path $directory
}
$workerRoot = Join-Path $projectRoot 'apps\browser-worker'
$entryPoint = Join-Path $workerRoot 'src\server.mjs'
$nodeBinary = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = [version]((& $nodeBinary --version).TrimStart('v'))
if ($LASTEXITCODE -ne 0 -or $nodeVersion -lt [version]'22.12.0') { throw 'The browser worker requires Node.js 22.12.0 or newer.' }
Push-Location $workerRoot
try {
    & $nodeBinary --input-type=module -e "await import('playwright')" *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Playwright is missing from the root workspace. Run npm install from the repository root; do not create an apps/browser-worker lockfile.'
    }
    & $nodeBinary --input-type=module -e "import { loadConfig } from './src/config.mjs'; loadConfig();" *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Browser-worker configuration is invalid. Check the documented server-side settings; no process was started.' }
} finally { Pop-Location }

function Test-WorkerHealth {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseProxy = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(3)
    try {
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, "$($endpoint.GetLeftPart([UriPartial]::Authority))/health")
        try {
            $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $env:BROWSER_WORKER_TOKEN)
            $response = $client.SendAsync($request).GetAwaiter().GetResult()
            try {
                if (-not $response.IsSuccessStatusCode) { return $false }
                $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                if ($body.Length -gt 65536) { return $false }
                $health = $body | ConvertFrom-Json
                return $health.status -eq 'ok' -and $health.service -eq 'browser-worker'
            } finally { $response.Dispose() }
        } finally { $request.Dispose() }
    } catch { return $false } finally { $client.Dispose() }
}

try {
    $launchLock = [IO.File]::Open((Join-Path $workerRuntime 'start.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch { throw 'Another browser-worker startup is in progress. Retry after it finishes; no process was stopped.' }
try {
$processFile = Join-Path $runtimeRoot 'browser-worker-process.json'
$existingRecord = $null
if (Test-Path -LiteralPath $processFile) {
    try { $existingRecord = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json } catch {
        throw 'The browser-worker process record is invalid. Inspect the dedicated runtime before starting another worker.'
    }
}
if ($existingRecord) {
    $existingProcess = Get-Process -Id ([int]$existingRecord.pid) -ErrorAction SilentlyContinue
    if ($existingRecord.name -eq 'browser-worker' -and $existingRecord.entryPoint -eq $entryPoint -and
        (Test-WorkbenchTrackedProcess -Process $existingProcess -Record $existingRecord)) {
        if ($existingRecord.port -eq $endpoint.Port -and (Test-WorkerHealth)) {
            Write-Host "Reusing the tracked browser worker on 127.0.0.1:$($endpoint.Port). No browser was opened."
            return
        }
        throw 'The tracked browser worker is running with different settings or failed health authentication. Stop it explicitly before starting another worker.'
    }
}
if (Test-WorkbenchPort -Port $endpoint.Port) {
    throw "Worker port $($endpoint.Port) is occupied without a matching healthy process record. No existing process was stopped."
}

$worker = $null
try {
    $worker = Start-Process -FilePath $nodeBinary -ArgumentList @("`"$entryPoint`"") -WorkingDirectory $workerRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'browser-worker.stdout.log') -RedirectStandardError (Join-Path $logRoot 'browser-worker.stderr.log')
    $record = @{name='browser-worker';pid=$worker.Id;startedAt=$worker.StartTime.ToUniversalTime().ToString('o');path=$nodeBinary;entryPoint=$entryPoint;port=$endpoint.Port}
    Write-WorkbenchUtf8 -Path $processFile -Content ($record | ConvertTo-Json -Depth 4)
    Protect-WorkbenchPath -Path $processFile
    Wait-WorkbenchPort -Port $endpoint.Port -TimeoutSeconds 20
    if (-not (Test-WorkerHealth)) { throw 'Browser-worker health authentication failed.' }
    $startedProcess = Get-Process -Id $worker.Id -ErrorAction SilentlyContinue
    if (-not (Test-WorkbenchTrackedProcess -Process $startedProcess -Record $record)) {
        throw 'The new browser-worker process exited before startup verification completed.'
    }
} catch {
    if ($worker -and $record) {
        $startedProcess = Get-Process -Id $worker.Id -ErrorAction SilentlyContinue
        if (Test-WorkbenchTrackedProcess -Process $startedProcess -Record $record) { Stop-Process -Id $worker.Id }
    }
    throw 'Browser-worker startup failed. Inspect the dedicated browser-worker logs; API and web processes were not stopped.'
}
Write-Host "Browser worker: http://127.0.0.1:$($endpoint.Port) (authenticated health verified)"
Write-Host 'No browser or account profile was opened. Account login remains an explicit administrator action.'
} finally { $launchLock.Dispose() }
