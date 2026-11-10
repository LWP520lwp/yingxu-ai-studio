[CmdletBinding()]
param(
    [switch]$NoOpenBrowser,
    [switch]$CheckOnly
)

# UTF-8 with BOM keeps Chinese diagnostics readable in Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Net.Http
. (Join-Path $PSScriptRoot 'common.ps1')
$projectRoot = Get-WorkbenchProjectRoot
$environmentPath = Join-Path $projectRoot '.env.local'
$launchLock = $null
$launchLog = $null

function Write-LaunchStatus {
    param([string]$Text)
    Write-Host $Text
    if ($script:launchLog) {
        $line = ('[{0}] {1}' -f [DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'), $Text) + [Environment]::NewLine
        [IO.File]::AppendAllText($script:launchLog, $line, [Text.UTF8Encoding]::new($false))
    }
}

function Get-LaunchJson {
    param([string]$Url, [string]$Bearer)
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(8)
    try {
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $Url)
        try {
            if ($Bearer) { $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Bearer) }
            $response = $client.SendAsync($request).GetAwaiter().GetResult()
            try {
                if (-not $response.IsSuccessStatusCode) { return $null }
                $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                if ($content.Length -gt 1048576) { return $null }
                return $content | ConvertFrom-Json
            } finally { $response.Dispose() }
        } finally { $request.Dispose() }
    } catch { return $null } finally { $client.Dispose() }
}

function Test-LaunchBootstrap {
    param([string]$Origin)
    $body = Get-LaunchJson -Url "$Origin/api/bootstrap"
    return $null -ne $body -and $null -ne $body.auth -and
        $null -ne $body.PSObject.Properties['models'] -and
        $null -ne $body.PSObject.Properties['skills'] -and
        $null -ne $body.PSObject.Properties['integration']
}

function Test-LaunchCanvas {
    param([string]$Origin)
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(5)
    try {
        $response = $client.GetAsync("$Origin/canvas-engine/index.html").GetAwaiter().GetResult()
        try {
            if (-not $response.IsSuccessStatusCode) { return $false }
            $html = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            return $html -match '/canvas-engine/assets/' -and $html -notmatch '/src/main\.tsx'
        } finally { $response.Dispose() }
    } catch { return $false } finally { $client.Dispose() }
}

function Get-LaunchRecords {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
    try { return @((Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_ }) }
    catch { throw '启动进程记录无法读取。请检查专属运行目录；现有服务未被停止。' }
}

function Test-LaunchCommand {
    param([string]$Name, [string]$CommandLine)
    if (-not $CommandLine) { return $false }
    if ($Name -eq 'api') {
        $match = [regex]::Match($CommandLine, '(?i)(?:^|\s)-jar\s+(?:"([^"]+)"|(\S+))')
        $jarPath = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
        if (-not $match.Success -or -not [IO.Path]::IsPathRooted($jarPath)) { return $false }
        return [string]::Equals([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($jarPath)),
            [IO.Path]::GetFullPath((Join-Path $script:projectRoot 'apps\api\target')), [StringComparison]::OrdinalIgnoreCase)
    }
    $expectedPaths = if ($Name -eq 'web') {
        @((Join-Path $script:projectRoot 'node_modules\vite\bin\vite.js'),
          (Join-Path $script:projectRoot 'apps\web\node_modules\vite\bin\vite.js'))
    } else { @((Join-Path $script:projectRoot 'apps\browser-worker\src\server.mjs')) }
    foreach ($path in $expectedPaths) {
        # Only accept a whole quoted/unquoted argument, never another project's prefix.
        $escaped = [regex]::Escape([IO.Path]::GetFullPath($path))
        if ($CommandLine -match ('(?i)(?:^|\s)(?:"' + $escaped + '"|' + $escaped + ')(?:\s|$)')) { return $true }
    }
    return $false
}

function Get-LaunchService {
    param([string]$Name, [int]$Port, [object[]]$Records)
    $owners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    $matching = @()
    foreach ($record in @($Records | Where-Object { $_.name -eq $Name })) {
        try {
            $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
            if (-not (Test-WorkbenchTrackedProcess -Process $process -Record $record)) { continue }
            $command = (Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction Stop).CommandLine
            if (Test-LaunchCommand -Name $Name -CommandLine $command) { $matching += $record }
        } catch { continue }
    }
    if ($owners.Count -gt 0) {
        if ($owners.Count -ne 1 -or @($matching | Where-Object { [int]$_.pid -eq [int]$owners[0] }).Count -ne 1) {
            throw "端口 $Port 被未确认属于此项目的程序占用。请换端口或自行处理占用；启动器不会关闭该程序。"
        }
        return 'running'
    }
    if ($matching.Count -gt 0) {
        throw "$Name 的已登记进程仍在运行，但端口 $Port 尚未就绪。请检查日志后重试；不会重复启动或强制结束进程。"
    }
    return 'stopped'
}

function Invoke-LaunchStep {
    param([string]$Label, [string]$LogName, [scriptblock]$Action)
    Write-LaunchStatus $Label
    $stepLog = Join-Path $script:logRoot $LogName
    try { & $Action *>> $stepLog }
    catch { throw "$Label 失败。请查看日志：$stepLog" }
}

function Invoke-LaunchNativeCommand {
    param([string]$FilePath, [string[]]$CommandArguments, [string]$FailureMessage)
    # Windows PowerShell 5.1 turns redirected native stderr into error records.
    # Build tools also write successful warnings there; their exit code decides.
    $previousErrorAction = $ErrorActionPreference
    $nativeExitCode = $null
    try {
        $ErrorActionPreference = 'Continue'
        & $FilePath @CommandArguments
        $nativeExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorAction }
    if ($null -eq $nativeExitCode -or $nativeExitCode -ne 0) { throw $FailureMessage }
}

function Wait-LaunchReady {
    param([scriptblock]$Check, [string]$Label, [int]$Seconds = 45)
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if (& $Check) { return }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Label 未在限定时间内就绪。请查看专属日志；启动器没有停止任何已有服务。"
}

function Save-LaunchProcess {
    param([string]$Name, [Diagnostics.Process]$Process, [string]$Path)
    $record = @{ name=$Name; pid=$Process.Id; startedAt=$Process.StartTime.ToUniversalTime().ToString('o'); path=$Path }
    $records = @(Get-LaunchRecords -Path $script:processFile)
    $records = @($records | Where-Object {
        if ([int]$_.pid -eq $Process.Id) { return $false }
        try { return Test-WorkbenchTrackedProcess -Process (Get-Process -Id ([int]$_.pid) -ErrorAction SilentlyContinue) -Record $_ }
        catch { return $false }
    }) + @($record)
    Write-WorkbenchUtf8 -Path $script:processFile -Content (ConvertTo-Json -InputObject @($records) -Depth 4)
}

try {
    if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
        if ($CheckOnly) { throw '尚未初始化本机配置。正常双击“一键启动.cmd”会建立专属 MySQL、Redis 及随机本机凭据。' }
        & (Join-Path $PSScriptRoot 'start-infra.ps1')
    }
    Import-WorkbenchEnvironment
    $runtimeRoot = [IO.Path]::GetFullPath((Get-WorkbenchRuntimeRoot))
    if ($runtimeRoot -notmatch '^[Ee]:[\\/].+') { throw '本机运行目录必须是 E: 盘上的专属目录。' }
    $logRoot = Join-Path $runtimeRoot 'logs'
    $processFile = Join-Path $runtimeRoot 'dev-processes.json'
    $apiPort = 0
    $webPort = 0
    if (-not [int]::TryParse($env:APP_PORT, [ref]$apiPort) -or $apiPort -lt 1024 -or $apiPort -gt 65535 -or
        -not [int]::TryParse($env:WEB_PORT, [ref]$webPort) -or $webPort -lt 1024 -or $webPort -gt 65535 -or $apiPort -eq $webPort) {
        throw 'APP_PORT / WEB_PORT 必须是不同的有效本机端口。请检查 .env.local，配置值不会打印。'
    }
    $apiOrigin = "http://127.0.0.1:$apiPort"
    $webOrigin = "http://127.0.0.1:$webPort"
    $pageUrl = "http://localhost:$webPort/"
    $env:FRONTEND_URL = $pageUrl.TrimEnd('/')
    $env:VITE_API_TARGET = $apiOrigin
    if (-not $CheckOnly) {
        New-Item -ItemType Directory -Path $runtimeRoot,$logRoot -Force | Out-Null
        try { $launchLock = [IO.File]::Open((Join-Path $runtimeRoot 'launcher.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch { throw '另一个一键启动正在执行。请等待它完成，不需要再次双击。' }
        $launchLog = Join-Path $logRoot 'launcher.log'
    }
    Write-LaunchStatus '映序工作台：正在检查此项目的服务。'
    $records = @(Get-LaunchRecords -Path $processFile)
    $apiState = Get-LaunchService -Name 'api' -Port $apiPort -Records $records
    $webState = Get-LaunchService -Name 'web' -Port $webPort -Records $records
    if ($apiState -eq 'running' -and -not (Test-LaunchBootstrap -Origin $apiOrigin)) { throw '已登记的 API 尚未健康，未启动第二个实例。请检查 api 日志后重试。' }
    if ($webState -eq 'running' -and -not (Test-LaunchCanvas -Origin $webOrigin)) { throw '已运行的前端缺少完整画布构建。请先构建画布再重试，已有服务未被关闭。' }

    $workerConfigured = $env:BROWSER_WORKER_URL -and $env:BROWSER_WORKER_TOKEN -and $env:POOL_CREDENTIAL_MASTER_KEY
    $workerState = 'stopped'
    if ($workerConfigured) {
        $workerUri = $null
        if (-not [Uri]::TryCreate($env:BROWSER_WORKER_URL, [UriKind]::Absolute, [ref]$workerUri) -or
            $workerUri.Scheme -ne 'http' -or $workerUri.Host -ne '127.0.0.1' -or $workerUri.UserInfo -or
            $workerUri.Port -lt 1024 -or $workerUri.Port -gt 65535 -or $workerUri.Query -or $workerUri.Fragment -or $workerUri.AbsolutePath -ne '/') {
            throw 'BROWSER_WORKER_URL 必须是有效的本机回环地址。'
        }
        $workerRecords = @(Get-LaunchRecords -Path (Join-Path $runtimeRoot 'browser-worker-process.json'))
        $workerState = Get-LaunchService -Name 'browser-worker' -Port $workerUri.Port -Records $workerRecords
        if ($workerState -eq 'running') {
            $workerHealth = Get-LaunchJson -Url "$($env:BROWSER_WORKER_URL.TrimEnd('/'))/health" -Bearer $env:BROWSER_WORKER_TOKEN
            if (-not $workerHealth -or $workerHealth.status -ne 'ok' -or $workerHealth.service -ne 'browser-worker') {
                throw '已登记的账号池执行器健康检查失败，未启动第二个实例；请检查执行器日志及服务端配置。'
            }
        }
    } elseif ($apiState -eq 'running') {
        throw 'API 正在运行，但账号池执行器配置尚未初始化。请先初始化执行器并通过 scripts/restart-api.ps1 明确重启 API；一键启动不会偷偷重启已运行服务。'
    }
    Write-LaunchStatus "API：$apiState；前端：$webState；账号池执行器：$workerState。"
    if ($CheckOnly) {
        if ($apiState -ne 'running' -or $webState -ne 'running' -or $workerState -ne 'running' -or -not (Test-LaunchBootstrap -Origin $webOrigin)) {
            throw '检查完成：部分服务未运行或代理未就绪。正常双击启动入口即可启动缺失服务；本次未修改任何配置或启动进程。'
        }
        Write-Host "检查通过：$pageUrl（只读检查，未打开浏览器、未启动进程）。"
        exit 0
    }

    if ($apiState -eq 'stopped' -or $webState -eq 'stopped' -or $workerState -eq 'stopped') {
        Invoke-LaunchStep -Label '检查并启动专属 MySQL / Redis' -LogName 'launcher-infra.log' -Action { & (Join-Path $PSScriptRoot 'start-infra.ps1') }
        Import-WorkbenchEnvironment
        $env:FRONTEND_URL = $pageUrl.TrimEnd('/')
        $env:VITE_API_TARGET = $apiOrigin
        $nodeBinary = (Get-Command node.exe -ErrorAction Stop).Source
        $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
        $nodeVersion = [version]((& $nodeBinary --version).TrimStart('v'))
        if ($nodeVersion -lt [version]'22.12.0') { throw '需要 Node.js 22.12.0 或以上；启动器不会替换你的系统工具。' }
        $env:npm_config_cache = Join-Path $runtimeRoot 'npm-cache'
        $viteBinary = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
        $workerPackage = Join-Path $projectRoot 'node_modules\playwright\package.json'
        if (-not (Test-Path -LiteralPath $viteBinary) -or -not (Test-Path -LiteralPath $workerPackage)) {
            Invoke-LaunchStep -Label '安装根工作区依赖（首次启动）' -LogName 'launcher-dependencies.log' -Action {
                Push-Location $projectRoot
                try { Invoke-LaunchNativeCommand -FilePath $npmCommand -CommandArguments @('ci') -FailureMessage 'npm ci failed.' } finally { Pop-Location }
            }
        }
        if ($workerState -eq 'stopped') {
            Invoke-LaunchStep -Label '启动账号池执行器' -LogName 'launcher-worker.log' -Action { & (Join-Path $PSScriptRoot 'start-browser-worker.ps1') }
            Import-WorkbenchEnvironment
            $env:FRONTEND_URL = $pageUrl.TrimEnd('/')
            $env:VITE_API_TARGET = $apiOrigin
        }
        if ($apiState -eq 'stopped') {
            $apiRoot = Join-Path $projectRoot 'apps\api'
            $javaBinary = Join-Path $env:JAVA_HOME 'bin\java.exe'
            if (-not (Test-Path -LiteralPath $javaBinary -PathType Leaf)) { throw '未找到项目配置的 Java。请先运行 scripts/install-java.ps1；启动器不会改动系统 Java。' }
            if (-not (Test-Path -LiteralPath $env:MAVEN_CMD -PathType Leaf)) { throw '未找到项目配置的 Maven，请检查 MAVEN_CMD。' }
            $jar = Get-ChildItem -LiteralPath (Join-Path $apiRoot 'target') -Filter '*.jar' -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -notmatch '(sources|javadoc|original)' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            $latestApiSource = Get-ChildItem -LiteralPath (Join-Path $apiRoot 'src') -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
            $apiPom = Get-Item -LiteralPath (Join-Path $apiRoot 'pom.xml')
            if (-not $jar -or $latestApiSource.LastWriteTimeUtc -gt $jar.LastWriteTimeUtc -or $apiPom.LastWriteTimeUtc -gt $jar.LastWriteTimeUtc) {
                Invoke-LaunchStep -Label '构建 API（首次启动或后端源码更新）' -LogName 'launcher-build-api.log' -Action {
                    Push-Location $apiRoot
                    try {
                        $mavenRepository = Join-Path $runtimeRoot 'maven-repository'
                        Invoke-LaunchNativeCommand -FilePath $env:MAVEN_CMD -CommandArguments @('--batch-mode', "-Dmaven.repo.local=$mavenRepository", '-DskipTests', 'package') -FailureMessage 'API packaging failed.'
                    } finally { Pop-Location }
                }
                $jar = Get-ChildItem -LiteralPath (Join-Path $apiRoot 'target') -Filter '*.jar' | Where-Object { $_.Name -notmatch '(sources|javadoc|original)' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            }
            if (-not $jar) { throw 'API 构建没有产生可运行的 jar。' }
            if (Test-WorkbenchPort -Port $apiPort) { throw 'API 端口在启动过程中被占用；未停止任何程序。' }
            Write-LaunchStatus '启动 API 服务。'
            $api = Start-Process -FilePath $javaBinary -ArgumentList @('-jar', "`"$($jar.FullName)`"", "--server.port=$apiPort") -WorkingDirectory $apiRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'api.stdout.log') -RedirectStandardError (Join-Path $logRoot 'api.stderr.log')
            Save-LaunchProcess -Name 'api' -Process $api -Path $javaBinary
            Wait-LaunchReady -Label 'API 服务' -Seconds 60 -Check { Test-LaunchBootstrap -Origin $apiOrigin }
        }
        if ($webState -eq 'stopped') {
            Invoke-LaunchStep -Label '构建完整 AI 画布' -LogName 'launcher-build-canvas.log' -Action {
                Push-Location $projectRoot
                try { Invoke-LaunchNativeCommand -FilePath $npmCommand -CommandArguments @('run', 'build:canvas') -FailureMessage 'Canvas build failed.' } finally { Pop-Location }
            }
            if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'apps\web\public\canvas-engine\index.html') -PathType Leaf)) { throw '完整画布构建产物缺失，前端未启动。' }
            if (Test-WorkbenchPort -Port $webPort) { throw '前端端口在启动过程中被占用；未停止任何程序。' }
            Write-LaunchStatus '启动前端开发服务。'
            $frontend = Start-Process -FilePath $nodeBinary -ArgumentList @("`"$viteBinary`"", '--host', '127.0.0.1', '--port', [string]$webPort, '--strictPort') -WorkingDirectory (Join-Path $projectRoot 'apps\web') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'web.stdout.log') -RedirectStandardError (Join-Path $logRoot 'web.stderr.log')
            Save-LaunchProcess -Name 'web' -Process $frontend -Path $nodeBinary
        }
    } else { Write-LaunchStatus '已复用正在运行的本项目服务，未重复启动或重启。' }
    Wait-LaunchReady -Label '前端及 API 代理' -Check { (Test-LaunchCanvas -Origin $webOrigin) -and (Test-LaunchBootstrap -Origin $webOrigin) }
    Write-LaunchStatus "工作台已就绪：$pageUrl"
    Write-LaunchStatus "日志目录：$logRoot"
    Write-LaunchStatus '账号池执行器已就绪；不会自动打开供应商登录页或修改登录开关。'
    if (-not $NoOpenBrowser) { Start-Process -FilePath $pageUrl | Out-Null }
    exit 0
} catch {
    Write-Host ''
    Write-Host ('启动未完成：' + $_.Exception.Message) -ForegroundColor Red
    if ($launchLog) { Write-Host "启动日志：$launchLog" }
    exit 1
} finally {
    if ($launchLock) { $launchLock.Dispose() }
}
