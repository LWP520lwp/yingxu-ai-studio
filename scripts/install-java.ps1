[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'common.ps1')
$runtimeRoot = Get-WorkbenchRuntimeRoot
$javaRoot = Join-Path $runtimeRoot 'java'
$downloadRoot = Join-Path $runtimeRoot 'downloads'
$javaHome = Join-Path $javaRoot 'jdk-21.0.13+9'
$archivePath = Join-Path $downloadRoot 'OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip'
$expectedHash = 'a4dbaa05fca4bd89d84584e58c459bd732efebb1722af80ab13c6516832004f9'
$downloadUrl = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip'
if (Test-Path -LiteralPath (Join-Path $javaHome 'bin\java.exe')) {
    & (Join-Path $javaHome 'bin\java.exe') -version
    return
}
New-Item -ItemType Directory -Path $javaRoot,$downloadRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $archivePath)) {
    & curl.exe --fail --location --retry 2 --output $archivePath $downloadUrl
    if ($LASTEXITCODE -ne 0) { throw 'Official Java download failed.' }
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
    throw 'Java archive SHA256 verification failed. Do not extract this archive.'
}
Expand-Archive -LiteralPath $archivePath -DestinationPath $javaRoot
& (Join-Path $javaHome 'bin\java.exe') -version
Write-Host "Portable Java installed at $javaHome. Global environment was not changed."

