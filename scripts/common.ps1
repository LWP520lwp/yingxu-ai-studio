$ErrorActionPreference = 'Stop'

function Get-WorkbenchProjectRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Import-WorkbenchEnvironment {
    param([string]$Path = (Join-Path (Get-WorkbenchProjectRoot) '.env.local'))
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Missing .env.local. Run scripts/start-infra.ps1 first."
    }
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
            throw 'Invalid environment file entry; use KEY=value without shell expressions.'
        }
        $name = $Matches[1]
        $value = $Matches[2]
        # Literal single-quoted dotenv values also work with Docker Compose, including PBKDF2 hashes.
        if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

function Get-WorkbenchRuntimeRoot {
    if ($env:WORKBENCH_RUNTIME_ROOT) { return $env:WORKBENCH_RUNTIME_ROOT }
    return 'E:\codex\runtime\creative-workbench'
}

function Test-WorkbenchPort {
    param([int]$Port)
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if ($task.Wait(250) -and $client.Connected) { return $true }
        return $false
    } catch { return $false } finally { $client.Dispose() }
}

function Wait-WorkbenchPort {
    param([int]$Port, [int]$TimeoutSeconds = 45)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-WorkbenchPort -Port $Port) { return }
        Start-Sleep -Milliseconds 400
    }
    throw "Service did not start on 127.0.0.1:$Port. Inspect the dedicated runtime logs."
}

function Test-WorkbenchRedis {
    param([int]$Port, [string]$Password)
    $socket = [Net.Sockets.TcpClient]::new()
    try {
        $socket.ReceiveTimeout = 3000
        $socket.SendTimeout = 3000
        $socket.Connect('127.0.0.1', $Port)
        $stream = $socket.GetStream()
        $writer = [IO.StreamWriter]::new($stream, [Text.Encoding]::ASCII)
        $writer.NewLine = "`r`n"
        $writer.AutoFlush = $true
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII)
        $writer.WriteLine('AUTH ' + $Password)
        if ($reader.ReadLine() -ne '+OK') { return $false }
        $writer.WriteLine('PING')
        return $reader.ReadLine() -eq '+PONG'
    } catch { return $false } finally { $socket.Dispose() }
}

function Protect-WorkbenchPath {
    param([string]$Path)
    $identitySid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $isDirectory = (Get-Item -LiteralPath $Path).PSIsContainer
    # icacls changes the DACL without trying to reapply audit/owner sections.
    # SIDs avoid localized names for SYSTEM and Administrators.
    $rights = if ($isDirectory) { '(OI)(CI)F' } else { 'F' }
    & icacls.exe $Path '/inheritance:r' '/grant:r' "*${identitySid}:$rights" "*S-1-5-18:$rights" "*S-1-5-32-544:$rights" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict local credential file permissions.' }
}

function New-WorkbenchSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Write-WorkbenchUtf8 {
    param([string]$Path, [string]$Content)
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Test-WorkbenchTrackedProcess {
    param($Process, $Record)
    if (-not $Process) { return $false }
    # PowerShell 7 ConvertFrom-Json may already parse ISO dates as UTC DateTime;
    # reparsing their culture-formatted string would lose the UTC kind.
    $recordedUtc = ([DateTimeOffset]$Record.startedAt).UtcDateTime
    $sameStart = [Math]::Abs(($Process.StartTime.ToUniversalTime() - $recordedUtc).TotalSeconds) -lt 1
    $samePath = [string]::Equals([IO.Path]::GetFullPath($Process.Path), [IO.Path]::GetFullPath($Record.path), [StringComparison]::OrdinalIgnoreCase)
    return $sameStart -and $samePath
}

