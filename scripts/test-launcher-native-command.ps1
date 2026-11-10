[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$launcherPath = Join-Path $PSScriptRoot 'launch-workbench.ps1'
$parseErrors = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($launcherPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Launcher syntax is invalid.' }
foreach ($name in @('Invoke-LaunchStep', 'Invoke-LaunchNativeCommand')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "Missing launcher function: $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Write-LaunchStatus { param([string]$Text) }
$nodeBinary = (Get-Command node.exe -ErrorAction Stop).Source
$script:logRoot = Join-Path ([IO.Path]::GetTempPath()) ('workbench-launcher-native-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:logRoot | Out-Null
try {
    Invoke-LaunchStep -Label 'warning case' -LogName 'warning.log' -Action {
        Invoke-LaunchNativeCommand -FilePath $nodeBinary -CommandArguments @('-e', "console.error('benign-warning');process.exit(0)") -FailureMessage 'Unexpected native failure.'
        'after-warning'
    }
    $warningLog = Get-Content -LiteralPath (Join-Path $script:logRoot 'warning.log') -Raw
    if ($warningLog -notmatch 'benign-warning' -or $warningLog -notmatch 'after-warning') { throw 'Successful native stderr did not continue or was not logged.' }
    if ($ErrorActionPreference -ne 'Stop') { throw 'Error action preference leaked.' }

    $failed = $false
    try {
        Invoke-LaunchStep -Label 'failure case' -LogName 'failure.log' -Action {
            Invoke-LaunchNativeCommand -FilePath $nodeBinary -CommandArguments @('-e', "console.error('expected-native-failure');process.exit(7)") -FailureMessage 'Expected native failure.'
            'after-failure'
        }
    } catch { $failed = $true }
    if (-not $failed) { throw 'A nonzero exit code was accepted.' }
    $failureLog = Get-Content -LiteralPath (Join-Path $script:logRoot 'failure.log') -Raw
    if ($failureLog -notmatch 'expected-native-failure' -or $failureLog -match 'after-failure') { throw 'Failed native command continued or lost its log.' }

    $scriptFailed = $false
    try {
        Invoke-LaunchStep -Label 'PowerShell error case' -LogName 'powershell.log' -Action { Write-Error 'expected-script-error' }
    } catch { $scriptFailed = $true }
    if (-not $scriptFailed -or $ErrorActionPreference -ne 'Stop') { throw 'PowerShell errors no longer terminate the step.' }
    Write-Host 'PASS: native stderr with exit 0 continues and is logged; exit 7 fails; PowerShell errors still stop.'
} finally {
    foreach ($name in @('warning.log', 'failure.log', 'powershell.log')) {
        $logPath = Join-Path $script:logRoot $name
        if (Test-Path -LiteralPath $logPath -PathType Leaf) { Remove-Item -LiteralPath $logPath }
    }
    Remove-Item -LiteralPath $script:logRoot
}
