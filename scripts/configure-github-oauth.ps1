[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$RequireConfigured,
    [string]$RedirectUri
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Assert-GithubEnvironmentFile {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw 'Missing .env.local. Run the workbench infrastructure setup first.'
    }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The local environment file must be a regular file, not a reparse point.'
    }
    if ($item.Length -gt 2MB) { throw 'The local environment file is unexpectedly large.' }
}

function ConvertTo-GithubRedirectUri {
    param([Parameter(Mandatory=$true)][string]$Value)
    $uri = $null
    if ($Value -match '[\r\n\x00]' -or
        -not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -cnotin @('http', 'https') -or -not $uri.Host -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        -not $uri.AbsolutePath.EndsWith('/login/oauth2/code/github', [StringComparison]::Ordinal) -or
        $uri.Port -lt 1 -or $uri.Port -gt 65535) {
        throw 'Use a complete HTTP(S) GitHub callback URL without credentials, query, or fragment.'
    }
    return $uri.AbsoluteUri
}

function Get-GithubConfigurationStatus {
    param([Parameter(Mandatory=$true)][string]$Path)
    Assert-GithubEnvironmentFile -Path $Path
    $values = @{}
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $entry = $line.Trim()
        if (-not $entry -or $entry.StartsWith('#')) { continue }
        if ($entry -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
            throw 'Invalid environment file entry; use KEY=value without shell expressions.'
        }
        if ($Matches[1] -in @('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI', 'APP_PORT')) {
            $values[$Matches[1]] = $Matches[2]
        }
    }
    $callback = $values['GITHUB_REDIRECT_URI']
    $callbackConfigured = -not [string]::IsNullOrWhiteSpace($callback)
    if (-not $callbackConfigured) {
        $port = 8088
        $parsedPort = 0
        if ([int]::TryParse($values['APP_PORT'], [ref]$parsedPort) -and $parsedPort -ge 1 -and $parsedPort -le 65535) { $port = $parsedPort }
        $callback = "http://localhost:$port/login/oauth2/code/github"
    }
    $validCallback = $true
    try { $callback = ConvertTo-GithubRedirectUri -Value $callback }
    catch { $callback = '<invalid callback>'; $validCallback = $false }
    return [pscustomobject]@{
        ClientIdPresent = -not [string]::IsNullOrWhiteSpace($values['GITHUB_CLIENT_ID'])
        ClientSecretPresent = -not [string]::IsNullOrWhiteSpace($values['GITHUB_CLIENT_SECRET'])
        Callback = $callback
        CallbackConfigured = $callbackConfigured
        CallbackValid = $validCallback
    }
}

function Set-GithubOAuthConfiguration {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$ClientId,
        [Parameter(Mandatory=$true)][Security.SecureString]$ClientSecret,
        [Parameter(Mandatory=$true)][string]$Callback
    )
    Assert-GithubEnvironmentFile -Path $Path
    if ($ClientId -cnotmatch '\A[A-Za-z0-9._-]{5,128}\z') { throw 'Client ID must be the single-line ID from the GitHub OAuth application.' }
    $safeCallback = ConvertTo-GithubRedirectUri -Value $Callback
    $secretPointer = [IntPtr]::Zero
    $plainSecret = $null
    $stream = $null
    try {
        $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ClientSecret)
        $plainSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
        if ($plainSecret -cnotmatch '\A[\x21-\x7E]{16,512}\z') {
            throw 'Client Secret must be the complete single-line secret from GitHub, without surrounding whitespace.'
        }
        # Restrict the existing file before opening it. In-place writes preserve its
        # ACL and avoid creating plaintext backup or temporary environment files.
        Protect-WorkbenchPath -Path $Path
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true, 4096, $true)
        try { $existing = $reader.ReadToEnd() } finally { $reader.Dispose() }
        foreach ($line in ($existing -split '\r?\n')) {
            $entry = $line.Trim()
            if ($entry -and -not $entry.StartsWith('#') -and $entry -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
                throw 'Invalid environment file entry; existing settings were left unchanged.'
            }
        }
        $newline = if ($existing.Contains("`r`n")) { "`r`n" } else { "`n" }
        $newValues = [ordered]@{ GITHUB_CLIENT_ID = $ClientId; GITHUB_CLIENT_SECRET = $plainSecret; GITHUB_REDIRECT_URI = $safeCallback }
        $updated = $existing
        foreach ($key in $newValues.Keys) {
            $pattern = '(?m)^[\t ]*' + [regex]::Escape($key) + '=[^\r\n]*'
            $replacement = $key + '=' + $newValues[$key]
            if ([regex]::IsMatch($updated, $pattern)) {
                # MatchEvaluator keeps literal dollar signs and other secret bytes.
                $updated = [regex]::Replace($updated, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($match) $replacement })
            } else {
                if ($updated.Length -gt 0 -and -not $updated.EndsWith("`n")) { $updated += $newline }
                $updated += $replacement + $newline
            }
        }
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($updated)
        $stream.Position = 0
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.SetLength($bytes.Length)
        $stream.Flush($true)
    } finally {
        if ($stream) { $stream.Dispose() }
        if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
        $plainSecret = $null
        $existing = $null
        $updated = $null
        $newValues = $null
        $bytes = $null
    }
}

# Dot-sourcing exposes the helpers for fixture-based checks without prompting or
# touching the caller's project configuration.
if ($MyInvocation.InvocationName -eq '.') { return }

try {
    $environmentPath = Join-Path (Get-WorkbenchProjectRoot) '.env.local'
    $status = Get-GithubConfigurationStatus -Path $environmentPath
    if ($CheckOnly -or $RequireConfigured) {
        Write-Host ('Client ID configured: ' + $status.ClientIdPresent)
        Write-Host ('Client Secret configured: ' + $status.ClientSecretPresent)
        Write-Host ('Callback: ' + $status.Callback)
        Write-Host ('Callback explicitly configured: ' + $status.CallbackConfigured)
        if (-not $status.CallbackValid -or ($RequireConfigured -and
            (-not $status.ClientIdPresent -or -not $status.ClientSecretPresent))) { exit 1 }
        exit 0
    }
    Write-Host 'Configure GitHub OAuth for this workbench only. Secret input is hidden.'
    Write-Host 'Create the OAuth application at https://github.com/settings/applications/new'
    $callbackDefault = if ($RedirectUri) { ConvertTo-GithubRedirectUri -Value $RedirectUri } elseif ($status.CallbackValid) { $status.Callback } else { 'http://localhost:8088/login/oauth2/code/github' }
    Write-Host ('GitHub callback must match: ' + $callbackDefault)
    $clientIdInput = (Read-Host 'Client ID').Trim()
    $secretInput = Read-Host 'Client Secret (hidden)' -AsSecureString
    try {
        $callbackInput = Read-Host ('Callback URL [Enter for ' + $callbackDefault + ']')
        if ([string]::IsNullOrWhiteSpace($callbackInput)) { $callbackInput = $callbackDefault }
        Set-GithubOAuthConfiguration -Path $environmentPath -ClientId $clientIdInput -ClientSecret $secretInput -Callback $callbackInput.Trim()
    } finally { if ($secretInput) { $secretInput.Dispose() } }
    Write-Host 'GitHub OAuth configuration saved to this project .env.local. No credentials were printed.'
    Write-Host 'Restart this project API with scripts/restart-api.ps1 -SkipBuild, then refresh the page.'
} catch {
    Write-Host ('GitHub OAuth setup did not finish: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
