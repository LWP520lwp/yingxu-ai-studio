[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'configure-github-oauth.ps1')

$fixtureParent = 'E:\codex\runtime\creative-workbench\oauth-config-tests'
$fixtureRoot = Join-Path $fixtureParent ([Guid]::NewGuid().ToString('N'))
$fixtureScripts = Join-Path $fixtureRoot 'scripts'
$fixtureFile = Join-Path $fixtureRoot '.env.local'
$passed = 0
function Assert-Check {
    param([bool]$Value, [string]$Description)
    if (-not $Value) { throw $Description }
    $script:passed++
}
function Assert-Rejected {
    param([scriptblock]$Action, [string]$Description)
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    Assert-Check -Value $rejected -Description $Description
}

try {
    New-Item -ItemType Directory -Path $fixtureScripts -Force | Out-Null
    Protect-WorkbenchPath -Path $fixtureRoot
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'common.ps1') -Destination $fixtureScripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'configure-github-oauth.ps1') -Destination $fixtureScripts
    $fixtureText = "# fixture comment`r`nAPP_PORT=8088`r`nOTHER_VALUE=preserve-me`r`nGITHUB_CLIENT_ID=old-id`r`nGITHUB_CLIENT_SECRET=old-value`r`nGITHUB_CLIENT_ID=duplicate`r`n"
    [IO.File]::WriteAllText($fixtureFile, $fixtureText, [Text.UTF8Encoding]::new($false))
    Protect-WorkbenchPath -Path $fixtureFile
    $beforeAcl = (Get-Acl -LiteralPath $fixtureFile).Sddl
    $fakeSecret = ConvertTo-SecureString 'fake-secret-0123456789-$-literal' -AsPlainText -Force
    try {
        Set-GithubOAuthConfiguration -Path $fixtureFile -ClientId 'fixture-client-12345' -ClientSecret $fakeSecret -Callback 'http://localhost:8088/login/oauth2/code/github'
    } finally { $fakeSecret.Dispose() }
    $actual = [IO.File]::ReadAllText($fixtureFile)
    Assert-Check ($actual.Contains("# fixture comment`r`nAPP_PORT=8088`r`nOTHER_VALUE=preserve-me`r`n")) 'Unrelated lines or line endings were changed.'
    Assert-Check (([regex]::Matches($actual, '(?m)^GITHUB_CLIENT_ID=fixture-client-12345\r?$')).Count -eq 2) 'Duplicate GitHub ID keys were not consistently replaced.'
    Assert-Check ($actual.Contains('GITHUB_CLIENT_SECRET=fake-secret-0123456789-$-literal')) 'Literal secret bytes were changed by replacement processing.'
    Assert-Check ($actual.Contains('GITHUB_REDIRECT_URI=http://localhost:8088/login/oauth2/code/github')) 'The missing callback was not appended.'
    Assert-Check ((Get-Acl -LiteralPath $fixtureFile).Sddl -eq $beforeAcl) 'The restricted file ACL changed.'

    $validSecret = ConvertTo-SecureString 'fixture-secret-0123456789' -AsPlainText -Force
    try {
        Assert-Rejected { Set-GithubOAuthConfiguration -Path $fixtureFile -ClientId "bad`nINJECTED=value" -ClientSecret $validSecret -Callback 'http://localhost:8088/login/oauth2/code/github' } 'Multiline Client ID was accepted.'
        Assert-Rejected { Set-GithubOAuthConfiguration -Path $fixtureFile -ClientId 'fixture-client-12345' -ClientSecret $validSecret -Callback 'http://localhost:8088/login/oauth2/code/github?secret=invalid' } 'Callback query was accepted.'
        Assert-Rejected { Set-GithubOAuthConfiguration -Path $fixtureFile -ClientId 'fixture-client-12345' -ClientSecret $validSecret -Callback 'https://name:password@example.com/login/oauth2/code/github' } 'Callback user credentials were accepted.'
    } finally { $validSecret.Dispose() }
    $invalidSecret = ConvertTo-SecureString "bad-secret`nINJECTED=value" -AsPlainText -Force
    try {
        Assert-Rejected { Set-GithubOAuthConfiguration -Path $fixtureFile -ClientId 'fixture-client-12345' -ClientSecret $invalidSecret -Callback 'http://localhost:8088/login/oauth2/code/github' } 'Multiline Client Secret was accepted.'
    } finally { $invalidSecret.Dispose() }
    Assert-Check ([IO.File]::ReadAllText($fixtureFile) -ceq $actual) 'Rejected input modified the existing environment.'

    $fixtureLauncher = Join-Path $fixtureScripts 'configure-github-oauth.ps1'
    $checkOutput = (& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $fixtureLauncher -CheckOnly 2>&1 | Out-String)
    $checkExit = $LASTEXITCODE
    Assert-Check ($checkExit -eq 0 -and $checkOutput.Contains('Client ID configured: True') -and $checkOutput.Contains('Client Secret configured: True')) 'CheckOnly did not recognize the fixture configuration under Windows PowerShell 5.1.'
    Assert-Check (-not $checkOutput.Contains('fixture-client-12345') -and -not $checkOutput.Contains('fake-secret-0123456789')) 'CheckOnly leaked fixture credentials.'
    Assert-Check ([IO.File]::ReadAllText($fixtureFile) -ceq $actual) 'CheckOnly modified the environment file.'
    $requiredOutput = (& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $fixtureLauncher -RequireConfigured 2>&1 | Out-String)
    Assert-Check ($LASTEXITCODE -eq 0) 'Complete configuration was rejected by RequireConfigured.'
    Assert-Check (-not $requiredOutput.Contains('fixture-client-12345') -and -not $requiredOutput.Contains('fake-secret-0123456789')) 'RequireConfigured leaked fixture credentials.'
    [IO.File]::WriteAllText($fixtureFile, "APP_PORT=8088`r`nGITHUB_CLIENT_ID=`r`nGITHUB_CLIENT_SECRET=`r`n", [Text.UTF8Encoding]::new($false))
    $missingOutput = (& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $fixtureLauncher -RequireConfigured 2>&1 | Out-String)
    Assert-Check ($LASTEXITCODE -eq 1 -and $missingOutput.Contains('Client Secret configured: False')) 'Incomplete configuration did not block the restart guard.'
    Write-Host ("GitHub OAuth configuration helper: $passed fixture checks passed. Existing project configuration was not opened or modified.")
} finally {
    # Only remove this invocation's fresh UUID fixture directory on E:.
    $resolvedParent = [IO.Path]::GetFullPath($fixtureParent).TrimEnd('\') + '\'
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    if (-not $resolvedFixture.StartsWith($resolvedParent, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedFixture) -notmatch '^[a-f0-9]{32}$') {
        throw 'Refusing to clean up a fixture outside its dedicated test directory.'
    }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
