param(
    [string]$BaseUrl = 'http://127.0.0.1:8088',
    [string]$FrontendOrigin = 'http://localhost:5178',
    [string]$RecoverJobId,
    [switch]$RecoverLatestKnownTask
)

$ErrorActionPreference = 'Stop'
# Development-only verification. Cookies stay inside WebRequestSession, are never
# printed or persisted, and no environment/config/provider credentials are read.
$base = [Uri]$BaseUrl
if ($base.Scheme -ne 'http' -or $base.Host -notin @('127.0.0.1', 'localhost', '::1', '[::1]') -or
    $base.UserInfo -or $base.Query -or $base.Fragment -or $base.AbsolutePath -ne '/') {
    throw 'Use an HTTP loopback API/frontend origin without credentials or paths.'
}
if ($RecoverJobId -and $RecoverLatestKnownTask) { throw 'Choose one recovery selector.' }
if ($RecoverJobId -and $RecoverJobId -notmatch '^[a-zA-Z0-9-]{1,128}$') { throw 'Invalid job ID.' }
$taskBase = $BaseUrl.TrimEnd('/')
$session = $null
$headers = @{ Origin = $FrontendOrigin; 'X-Workbench-Request' = '1' }

function Read-WorkbenchApi([string]$Path) {
    Invoke-RestMethod -Uri "$taskBase$Path" -WebSession $session -Headers $headers -Method Get -TimeoutSec 30
}
function Invoke-AllowedMutation([string]$Path) {
    if ($Path -notin @('/api/auth/local','/api/auth/logout') -and $Path -notmatch '^/api/jobs/[a-zA-Z0-9-]{1,128}/recover$') {
        throw 'This verification script cannot submit generation or modify projects.'
    }
    Invoke-RestMethod -Uri "$taskBase$Path" -WebSession $session -Headers $headers -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 180
}

$report = [ordered]@{ generationSubmitted = $false; providerCredentialsRead = $false; authenticated = $false }
try {
    # The returned identity and session cookies are deliberately not logged.
    # -SessionVariable also loads the web cmdlet's session type on Windows
    # PowerShell 5.1; constructing WebRequestSession before module load fails there.
    $null = Invoke-RestMethod -Uri "$taskBase/api/auth/local" -Headers $headers -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 30 -SessionVariable session
    $report.authenticated = $true
    $bootstrap = Read-WorkbenchApi '/api/bootstrap'
    $textCatalog = Read-WorkbenchApi '/api/models/text'
    $report.textModels = @($textCatalog.models | Where-Object { $_.id -in @('muse-spark','muse-service-spark') } |
        ForEach-Object { [ordered]@{ id = $_.id; available = [bool]$_.available } })
    $report.videoModes = @($bootstrap.models.video | Where-Object { $_.id -in @('muse-video','muse-service-video') } |
        ForEach-Object { [ordered]@{ id = $_.id; available = [bool]$_.available; supportedVideoModes = @($_.caps.supportedVideoModes); maxReferenceImages = $_.caps.maxReferenceImages; maxFrameImages = $_.caps.maxFrameImages } })
    $pool = Read-WorkbenchApi '/api/pool/accounts'
    $report.poolAccounts = @($pool.accounts | ForEach-Object {
        [ordered]@{ type = $_.type; state = $_.state; enabled = [bool]$_.enabled; busy = [bool]$_.busy; fresh = [bool]$_.fresh; schedulable = [bool]$_.schedulable; image = [bool]$_.capabilities.image; video = [bool]$_.capabilities.video }
    })
    $report.integration = [ordered]@{ enabled = [bool]$bootstrap.integration.enabled; status = $bootstrap.integration.status; modelDiscovery = $bootstrap.integration.modelDiscovery }
    if ($report.textModels.Count -ne 2) { $report.failure = 'Muse text gateway is missing; rebuild/restart API first.'; throw 'Missing models.' }
    $serviceVideo = $report.videoModes | Where-Object { $_.id -eq 'muse-service-video' } | Select-Object -First 1
    $nativeVideo = $report.videoModes | Where-Object { $_.id -eq 'muse-video' } | Select-Object -First 1
    if (-not $serviceVideo -or $serviceVideo.maxReferenceImages -ne 4 -or $serviceVideo.maxFrameImages -ne 2 -or 'frames' -notin $serviceVideo.supportedVideoModes -or
        -not $nativeVideo -or $nativeVideo.maxReferenceImages -ne 2 -or 'frames' -in $nativeVideo.supportedVideoModes) {
        $report.failure = 'Muse service/browser capabilities do not match the implemented transport.'; throw 'Capability mismatch.'
    }
    $jobs = @(Read-WorkbenchApi '/api/jobs')
    $eligible = @($jobs | Where-Object { $_.canRecover -and $_.kind -in @('image','video') })
    # Return only identifiers and operational state; no prompts, user identities,
    # provider task IDs, upstream URLs, cookies or arbitrary error response bodies.
    $report.recoverableJobs = @($eligible | Select-Object -First 15 | ForEach-Object {
        [ordered]@{ id = $_.id; kind = $_.kind; model = $_.model; status = $_.status }
    })
    if ($RecoverLatestKnownTask) {
        $candidate = $eligible | Where-Object { $_.model -eq 'muse-service-image' -and $_.error -match '\u5a92\u4f53|\u9519\u8bef\u9875\u9762|\u8d44\u6e90|text/plain' } | Select-Object -First 1
        if (-not $candidate) { throw 'No recoverable media-download failure belongs to this development session.' }
        $RecoverJobId = $candidate.id
    }
    if ($RecoverJobId) {
        $before = Read-WorkbenchApi "/api/jobs/$RecoverJobId"
        $recovered = Invoke-AllowedMutation "/api/jobs/$RecoverJobId/recover"
        if ($recovered.generationResubmitted -ne $false) { throw 'Recovery response did not explicitly confirm no resubmission.' }
        $report.recovery = [ordered]@{ id = $RecoverJobId; previousStatus = $before.status; status = $recovered.status; recoveryStatus = $recovered.recoveryStatus; generationResubmitted = $false; resultAssetAvailable = [bool]$recovered.resultAssetId }
        if ($recovered.status -eq 'succeeded' -and $recovered.resultAssetId) {
            $media = Invoke-WebRequest -UseBasicParsing -Uri "$taskBase/api/assets/$($recovered.resultAssetId)/content" -WebSession $session -Headers $headers -Method Get -TimeoutSec 60
            $report.recovery.mediaHttpStatus = [int]$media.StatusCode
            $report.recovery.mediaContentType = [string]$media.Headers['Content-Type']
            $again = Invoke-AllowedMutation "/api/jobs/$RecoverJobId/recover"
            $report.recovery.repeatedRecoverySameAsset = ($again.resultAssetId -eq $recovered.resultAssetId)
        }
    }
    $report.ok = $true
} catch {
    # Avoid PowerShell's default exception rendering of request headers/body.
    $report.ok = $false
    $report.errorType = $_.Exception.GetType().Name
    if ($_.Exception.Response.StatusCode) { $report.httpStatus = [int]$_.Exception.Response.StatusCode }
} finally {
    if ($report.authenticated) { try { $null = Invoke-AllowedMutation '/api/auth/logout' } catch {} }
    $report | ConvertTo-Json -Depth 8
}
if (-not $report.ok) { exit 1 }
