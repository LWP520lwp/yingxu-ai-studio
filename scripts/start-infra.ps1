[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'common.ps1')

$projectRoot = Get-WorkbenchProjectRoot
$environmentPath = Join-Path $projectRoot '.env.local'
$runtimeRoot = Get-WorkbenchRuntimeRoot
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Protect-WorkbenchPath -Path $runtimeRoot

if (-not (Test-Path -LiteralPath $environmentPath)) {
    $dbSecret = New-WorkbenchSecret
    $rootSecret = New-WorkbenchSecret
    $adminSecret = New-WorkbenchSecret
    $redisSecret = New-WorkbenchSecret
    $mqSecret = New-WorkbenchSecret
    $runtimeForward = $runtimeRoot.Replace('\','/')
    $content = @"
APP_PROFILE=dev
APP_PORT=8088
WEB_PORT=5178
FRONTEND_URL=http://localhost:5178
VITE_API_TARGET=http://127.0.0.1:8088
DB_HOST=127.0.0.1
DB_PORT=3308
DB_NAME=workbench
DB_USERNAME=workbench
DB_PASSWORD=$dbSecret
DB_ROOT_PASSWORD=$rootSecret
DB_ADMIN_PASSWORD=$adminSecret
REDIS_HOST=127.0.0.1
REDIS_PORT=6381
REDIS_PASSWORD=$redisSecret
WORKBENCH_RUNTIME_ROOT=$runtimeForward
JAVA_HOME=$runtimeForward/java/jdk-21.0.13+9
MAVEN_CMD=E:/develop/apache-maven-3.9.6/apache-maven-3.9.6/bin/mvn.cmd
MYSQL_BASEDIR=E:/develop/mysql-8.0.31-winx64/mysql-8.0.31-winx64
REDIS_SERVER=E:/redis/redis-server.exe
APP_STORAGE_ROOT=$runtimeForward/storage
MUSE_BASE_URL=http://127.0.0.1:18610
MUSE_API_KEY=
MUSE_LOCAL_KEY_ENABLED=false
MUSE_LOCAL_POOL_URL=http://127.0.0.1:18610
MUSE_MEDIA_ALLOWED_HOSTS=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
RABBITMQ_USERNAME=workbench
RABBITMQ_PASSWORD=$mqSecret
"@
    Write-WorkbenchUtf8 -Path $environmentPath -Content $content
    Protect-WorkbenchPath -Path $environmentPath
    Write-Host 'Created protected .env.local with random local credentials.'
}

Import-WorkbenchEnvironment
$runtimeRoot = Get-WorkbenchRuntimeRoot
foreach ($key in @('DB_PASSWORD','DB_ROOT_PASSWORD','DB_ADMIN_PASSWORD','REDIS_PASSWORD')) {
    if (-not [Environment]::GetEnvironmentVariable($key, 'Process')) {
        throw "Required secret $key is empty. Set it in .env.local."
    }
}
if ($env:DB_NAME -notmatch '^[A-Za-z][A-Za-z0-9_]*$' -or $env:DB_USERNAME -notmatch '^[A-Za-z][A-Za-z0-9_]*$') {
    throw 'Local bootstrap requires simple database and user identifiers.'
}
foreach ($key in @('DB_PASSWORD','DB_ROOT_PASSWORD','DB_ADMIN_PASSWORD','REDIS_PASSWORD')) {
    if ([Environment]::GetEnvironmentVariable($key, 'Process') -notmatch '^[A-Za-z0-9_-]{24,}$') {
        throw "Bootstrap requires $key to use at least 24 letters, numbers, underscores or hyphens."
    }
}

$mysqlRoot = Join-Path $runtimeRoot 'mysql'
$mysqlData = Join-Path $mysqlRoot 'data'
$redisRoot = Join-Path $runtimeRoot 'redis'
$logRoot = Join-Path $runtimeRoot 'logs'
New-Item -ItemType Directory -Path $mysqlRoot,$redisRoot,$logRoot,(Join-Path $mysqlRoot 'import'),$env:APP_STORAGE_ROOT -Force | Out-Null
$mysqlBinary = Join-Path $env:MYSQL_BASEDIR 'bin\mysqld.exe'
$mysqlClient = Join-Path $env:MYSQL_BASEDIR 'bin\mysql.exe'
if (-not (Test-Path -LiteralPath $mysqlBinary)) { throw 'MySQL binary not found at MYSQL_BASEDIR.' }
if (-not (Test-Path -LiteralPath $env:REDIS_SERVER)) { throw 'Redis binary not found at REDIS_SERVER.' }

$mysqlConfig = Join-Path $mysqlRoot 'my.ini'
$mysqlForward = $mysqlRoot.Replace('\','/')
$mysqlConfigText = @"
[mysqld]
basedir=$($env:MYSQL_BASEDIR.Replace('\','/'))
datadir=$mysqlForward/data
port=$env:DB_PORT
bind-address=127.0.0.1
mysqlx=0
skip-name-resolve=1
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
max_connections=150
local-infile=0
secure-file-priv=$mysqlForward/import
log-error=$mysqlForward/mysql-error.log
pid-file=$mysqlForward/mysql.pid
"@
Write-WorkbenchUtf8 -Path $mysqlConfig -Content $mysqlConfigText
Protect-WorkbenchPath -Path $mysqlConfig
$clientConfig = Join-Path $mysqlRoot 'admin.cnf'
Write-WorkbenchUtf8 -Path $clientConfig -Content @"
[client]
host=127.0.0.1
port=$env:DB_PORT
user=workbench_admin
password=$env:DB_ADMIN_PASSWORD
"@
Protect-WorkbenchPath -Path $clientConfig

$mysqlMarker = Join-Path $mysqlRoot 'initialized.json'
if (Test-WorkbenchPort -Port ([int]$env:DB_PORT)) {
    if (-not (Test-Path -LiteralPath $mysqlMarker)) { throw 'MySQL port is occupied by an unrecognized service; it will not be changed.' }
    & $mysqlClient "--defaults-extra-file=$clientConfig" --batch --skip-column-names --execute='SELECT 1;' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Existing MySQL listener does not accept this runtime credential; it will not be changed.' }
    Write-Host "Dedicated MySQL is already healthy on 127.0.0.1:$env:DB_PORT."
} else {
    $isNew = -not (Test-Path -LiteralPath (Join-Path $mysqlData 'mysql'))
    if ($isNew) {
        New-Item -ItemType Directory -Path $mysqlData -Force | Out-Null
        & $mysqlBinary "--defaults-file=$mysqlConfig" --initialize-insecure
        if ($LASTEXITCODE -ne 0) { throw 'MySQL data initialization failed. Inspect the dedicated mysql-error.log.' }
    }
    $arguments = @("--defaults-file=`"$mysqlConfig`"")
    $initFile = Join-Path $mysqlRoot 'bootstrap.sql'
    if ($isNew -or -not (Test-Path -LiteralPath $mysqlMarker)) {
        Write-WorkbenchUtf8 -Path $initFile -Content @"
ALTER USER 'root'@'localhost' IDENTIFIED BY '$env:DB_ROOT_PASSWORD';
CREATE DATABASE IF NOT EXISTS $env:DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '$env:DB_USERNAME'@'127.0.0.1' IDENTIFIED BY '$env:DB_PASSWORD';
GRANT ALL PRIVILEGES ON $env:DB_NAME.* TO '$env:DB_USERNAME'@'127.0.0.1';
CREATE USER IF NOT EXISTS 'workbench_admin'@'127.0.0.1' IDENTIFIED BY '$env:DB_ADMIN_PASSWORD';
GRANT ALL PRIVILEGES ON *.* TO 'workbench_admin'@'127.0.0.1' WITH GRANT OPTION;
"@
        Protect-WorkbenchPath -Path $initFile
        $arguments += "--init-file=`"$initFile`""
    }
    $mysqlProcess = Start-Process -FilePath $mysqlBinary -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'mysql.stdout.log') -RedirectStandardError (Join-Path $logRoot 'mysql.stderr.log')
    Wait-WorkbenchPort -Port ([int]$env:DB_PORT)
    & $mysqlClient "--defaults-extra-file=$clientConfig" --batch --skip-column-names --execute='SELECT 1;' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'MySQL started but credential check failed. Inspect dedicated logs.' }
    Write-WorkbenchUtf8 -Path $mysqlMarker -Content (@{pid=$mysqlProcess.Id;port=[int]$env:DB_PORT;createdAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json)
    if (Test-Path -LiteralPath $initFile) { Remove-Item -LiteralPath $initFile }
    Write-Host "Dedicated MySQL is healthy on 127.0.0.1:$env:DB_PORT."
}

$redisConfig = Join-Path $redisRoot 'redis.conf'
$redisForward = $redisRoot.Replace('\','/')
Write-WorkbenchUtf8 -Path $redisConfig -Content @"
bind 127.0.0.1
port $env:REDIS_PORT
protected-mode yes
requirepass $env:REDIS_PASSWORD
dir $redisForward
appendonly yes
appendfilename workbench.aof
dbfilename workbench.rdb
logfile $redisForward/redis.log
maxmemory 256mb
maxmemory-policy noeviction
"@
Protect-WorkbenchPath -Path $redisConfig
$redisPidFile = Join-Path $redisRoot 'process.json'
if (Test-WorkbenchPort -Port ([int]$env:REDIS_PORT)) {
    if (-not (Test-Path -LiteralPath $redisPidFile)) { throw 'Redis port is occupied by an unrecognized service; it will not be changed.' }
    if (-not (Test-WorkbenchRedis -Port ([int]$env:REDIS_PORT) -Password $env:REDIS_PASSWORD)) {
        throw 'Existing Redis listener does not accept this runtime credential; it will not be changed.'
    }
    Write-Host "Dedicated Redis is already healthy on 127.0.0.1:$env:REDIS_PORT."
} else {
    $redisProcess = Start-Process -FilePath $env:REDIS_SERVER -ArgumentList @("`"$redisConfig`"") -WorkingDirectory $redisRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'redis.stdout.log') -RedirectStandardError (Join-Path $logRoot 'redis.stderr.log')
    Wait-WorkbenchPort -Port ([int]$env:REDIS_PORT)
    if (-not (Test-WorkbenchRedis -Port ([int]$env:REDIS_PORT) -Password $env:REDIS_PASSWORD)) {
        throw 'Redis started but authentication/PING failed.'
    }
    Write-WorkbenchUtf8 -Path $redisPidFile -Content (@{pid=$redisProcess.Id;port=[int]$env:REDIS_PORT;startedAt=$redisProcess.StartTime.ToUniversalTime().ToString('o');path=$env:REDIS_SERVER} | ConvertTo-Json)
    Write-Host "Dedicated Redis is healthy on 127.0.0.1:$env:REDIS_PORT."
}
Write-Host 'Credentials were kept in protected local files and were not printed.'

