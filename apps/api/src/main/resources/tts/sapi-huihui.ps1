param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('voices', 'synthesize')]
    [string]$Mode,
    [Parameter(Mandatory = $true)]
    [string]$WorkDirectory,
    [string]$VoiceId = 'sapi-huihui-zh-cn'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$synthesizer = $null
try {
    Add-Type -AssemblyName System.Speech
    $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voice = $synthesizer.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -eq 'Microsoft Huihui Desktop' } | Select-Object -First 1
    if ($Mode -eq 'voices') {
        if ($null -eq $voice) { [Console]::Write('{"available":false}'); exit 0 }
        [Console]::Write('{"available":true,"id":"sapi-huihui-zh-cn","name":"Microsoft Huihui Desktop"}')
        exit 0
    }
    if ($null -eq $voice -or $VoiceId -ne 'sapi-huihui-zh-cn') { throw 'VOICE_UNAVAILABLE' }
    $directory = [System.IO.Path]::GetFullPath($WorkDirectory)
    if (-not [System.IO.Directory]::Exists($directory)) { throw 'DIRECTORY_UNAVAILABLE' }
    $textPath = [System.IO.Path]::Combine($directory, 'input.txt')
    $wavePath = [System.IO.Path]::Combine($directory, 'speech.wav')
    if (-not [System.IO.File]::Exists($textPath) -or [System.IO.File]::Exists($wavePath)) { throw 'INPUT_INVALID' }
    if ((Get-Item -LiteralPath $textPath).Length -gt 4096) { throw 'INPUT_TOO_LARGE' }
    $text = [System.IO.File]::ReadAllText($textPath, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($text) -or $text.Length -gt 800) { throw 'TEXT_INVALID' }
    $synthesizer.SelectVoice($voice.VoiceInfo.Name)
    $synthesizer.Rate = 0
    $synthesizer.Volume = 100
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $synthesizer.SetOutputToWaveFile($wavePath, $format)
    # Speak treats the UTF-8 contents as plain text. No Invoke-Expression or SSML.
    $synthesizer.Speak($text)
    $synthesizer.SetOutputToNull()
    if ((Get-Item -LiteralPath $wavePath).Length -gt 8388608) { throw 'OUTPUT_TOO_LARGE' }
    [Console]::Write('{"ok":true}')
} catch {
    # Keep narration and local paths out of process diagnostics.
    [Console]::Error.Write('SAPI_TTS_FAILED')
    exit 2
} finally {
    if ($null -ne $synthesizer) { $synthesizer.Dispose() }
}
