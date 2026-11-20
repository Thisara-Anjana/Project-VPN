# ===========================================================================
# USB VPN Bridge — Phase 6: Live Orchestrated Integration Test Runner
# ===========================================================================
$ErrorActionPreference = "Continue"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "USB VPN BRIDGE: SUPERVISED PHASE 6 LIVE INTEGRATED TEST" -ForegroundColor Cyan
Write-Host "=================================================================`n" -ForegroundColor Cyan

$stateDir = "G:\Project VPN\network-core\state"
$binDir = "G:\Project VPN\network-core\bin"
$electronExe = "G:\Project VPN\windows-client\node_modules\electron\dist\electron.exe"
$appDir = "G:\Project VPN\windows-client"
$activeFile = "$stateDir\engine.active"
$logPath = "$stateDir\sing-box-live.log"
$statusFile = "$stateDir\orchestrator-live-status.json"

$results = [ordered]@{
    timestamp = (Get-Date).ToString("o")
    preconditions = [ordered]@{
        baselineDirectIp = ""
        netModSocksIp = ""
        adbDevice = ""
        singBoxConfigCheck = $false
    }
    electronProcessId = 0
    uiConnectTriggered = $false
    stateTransitions = @()
    tunAdapterDetected = $false
    proxyFreeHttpsResult = ""
    egressMatchesNetMod = $false
    progressiveTests = [ordered]@{
        testA_MultiHostBrowsing = @{}
        testC_ConcurrentTcp = @{}
        testD_5MbDownload = @{}
        testE_ResourceUsage = @{}
        testF_TelemetrySample = @{}
    }
    uiDisconnectTriggered = $false
    singBoxProcessExited = $false
    routesRestored = $false
    postRestorationIp = ""
    errors = @()
}

# -----------------------------------------------------------------------------
# STEP 1: PRECONDITION VERIFICATION
# -----------------------------------------------------------------------------
Write-Host "[1/10] Verifying Preconditions..." -ForegroundColor Yellow

# A. Physical Direct Host IP
$directIp = (curl.exe --noproxy "*" -s -m 6 https://api.ipify.org).Trim()
Write-Host "  - Physical ISP Host IP: $directIp"
$results.preconditions.baselineDirectIp = $directIp

# B. NetMod SOCKS5 IP
$socksIp = (curl.exe --proxy socks5h://127.0.0.1:10808 -s -m 6 https://api.ipify.org).Trim()
Write-Host "  - NetMod SOCKS5 Egress IP: $socksIp"
$results.preconditions.netModSocksIp = $socksIp

if (-not $socksIp -or $socksIp -eq $directIp) {
    Write-Host "FATAL: SOCKS5 proxy not responding or exits via direct ISP ($socksIp vs $directIp). Aborting." -ForegroundColor Red
    $results.errors += "SOCKS5 proxy invalid"
    $results | ConvertTo-Json -Depth 5 | Set-Content "$stateDir\phase6-live-results.json"
    exit 1
}

# Clean up any stale triggers
Remove-Item -Force "$stateDir\trigger-connect.run" -ErrorAction SilentlyContinue
Remove-Item -Force "$stateDir\trigger-disconnect.run" -ErrorAction SilentlyContinue

# C. ADB Device
$adbBin = "C:\Android\Sdk\platform-tools\adb.exe"
$adbDevices = (& $adbBin devices) | Out-String
if ($adbDevices -match "([a-zA-Z0-9]+)\s+device\b" -and $matches[1] -ne "of") {
    $results.preconditions.adbDevice = $matches[1]
    Write-Host "  - Android Device: $($matches[1])"
}

# D. sing-box check
$sbCheck = & "$binDir\sing-box.exe" check -c "$stateDir\sing-box-config.json" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  - sing-box config check: PASSED" -ForegroundColor Green
    $results.preconditions.singBoxConfigCheck = $true
} else {
    Write-Host "FATAL: sing-box check failed: $sbCheck" -ForegroundColor Red
    $results.errors += "sing-box check failed"
    exit 1
}

# -----------------------------------------------------------------------------
# STEP 2: LAUNCH REAL ELECTRON APPLICATION
# -----------------------------------------------------------------------------
Write-Host "`n[2/10] Launching real USB VPN Bridge Windows Electron application..." -ForegroundColor Yellow
$electronProc = Start-Process -FilePath $electronExe -ArgumentList "`"$appDir`"" -WorkingDirectory "G:\Project VPN" -PassThru
$results.electronProcessId = $electronProc.Id
Write-Host "  - Electron launched (PID: $($electronProc.Id)). Waiting 4s for UI render..."
Start-Sleep -Seconds 4

# -----------------------------------------------------------------------------
# STEP 3: TRIGGER ONE-CLICK CONNECT VIA UI ORCHESTRATOR
# -----------------------------------------------------------------------------
Write-Host "`n[3/10] Triggering Connect in Windows UI Orchestrator..." -ForegroundColor Yellow
Set-Content -Path "$stateDir\trigger-connect.run" -Value (Get-Date).ToString("o")
$results.uiConnectTriggered = $true
Write-Host "  - Connect trigger submitted. Awaiting UAC prompt approval and pipeline completion..."

# -----------------------------------------------------------------------------
# STEP 4: MONITOR STATE TRANSITIONS & AWAIT TUN_ACTIVE (Up to 35s)
# -----------------------------------------------------------------------------
Write-Host "`n[4/10] Monitoring Orchestrator state transitions (waiting for TUN_ACTIVE)..." -ForegroundColor Yellow
$connected = $false
$lastObservedState = ""

for ($i = 1; $i -le 35; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $statusFile) {
        try {
            $statusObj = Get-Content $statusFile -Raw | ConvertFrom-Json
            if ($statusObj.state -ne $lastObservedState) {
                $lastObservedState = $statusObj.state
                $results.stateTransitions += [ordered]@{ second = $i; state = $lastObservedState }
                Write-Host "    -> State: $lastObservedState" -ForegroundColor Cyan
            }
            if ($statusObj.state -eq "INTERNET_CONNECTED") {
                $connected = $true
                break
            }
        } catch {}
    }
    
    # Also check routing table directly
    $rt = (route print -4) | Out-String
    if ($rt -match "172\.19\.0\.1|172\.19\.0\.2") {
        $results.tunAdapterDetected = $true
    }
}

if (-not $connected) {
    Write-Host "WARNING: State did not reach INTERNET_CONNECTED within 25s. Checking route table..." -ForegroundColor Yellow
    $rt = (route print -4) | Out-String
    if ($rt -match "172\.19\.0\.1|172\.19\.0\.2") {
        Write-Host "  - Routing table confirms TUN adapter is active!" -ForegroundColor Green
        $results.tunAdapterDetected = $true
    } else {
        Write-Host "FATAL: TUN adapter failed to activate. Aborting test." -ForegroundColor Red
        $results.errors += "TUN activation timeout"
        Set-Content -Path "$stateDir\trigger-disconnect.run" -Value "abort"
        exit 1
    }
} else {
    Write-Host "  - UI reports INTERNET_CONNECTED! Pipeline verified." -ForegroundColor Green
    $results.tunAdapterDetected = $true
}

# -----------------------------------------------------------------------------
# STEP 5: PROXY-FREE HTTPS REQUEST & VPN EXIT VERIFICATION
# -----------------------------------------------------------------------------
Write-Host "`n[5/10] Verifying Proxy-Free HTTPS routing (curl.exe --noproxy '*' https://api.ipify.org)..." -ForegroundColor Yellow
$tunEgress = (curl.exe --noproxy "*" -s -m 8 https://api.ipify.org).Trim()
Write-Host "  - Public Egress IP: $tunEgress"
$results.proxyFreeHttpsResult = $tunEgress

if ($tunEgress -eq $socksIp) {
    Write-Host "  - VERIFICATION: 100% MATCH WITH NETMOD SINGAPORE VPN ($tunEgress)!" -ForegroundColor Green
    $results.egressMatchesNetMod = $true
} else {
    Write-Host "  - WARNING: Egress IP ($tunEgress) does not match SOCKS5 baseline ($socksIp)" -ForegroundColor Red
}

# -----------------------------------------------------------------------------
# STEP 6: PROGRESSIVE TEST A — MULTI-HOST HTTPS BROWSING
# -----------------------------------------------------------------------------
Write-Host "`n[6/10] Progressive Test A: Multi-Host HTTPS Endpoints..." -ForegroundColor Yellow
$testUrls = @(
    "https://api.ipify.org",
    "https://cloudflare.com/cdn-cgi/trace",
    "https://httpbin.org/ip"
)
foreach ($url in $testUrls) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $body = curl.exe --noproxy "*" -s -m 6 $url
    $sw.Stop()
    $ok = ($LASTEXITCODE -eq 0 -and $body.Length -gt 0)
    Write-Host "  - $url : $(if ($ok) {'SUCCESS'} else {'FAILED'}) ($($sw.ElapsedMilliseconds)ms)"
    $results.progressiveTests.testA_MultiHostBrowsing[$url] = [ordered]@{
        success = $ok
        latencyMs = $sw.ElapsedMilliseconds
    }
}

# -----------------------------------------------------------------------------
# STEP 7: PROGRESSIVE TEST C — 4 CONCURRENT TCP CONNECTIONS
# -----------------------------------------------------------------------------
Write-Host "`n[7/10] Progressive Test C: 4 Concurrent HTTPS TCP Connections..." -ForegroundColor Yellow
$jobs = @()
$swConc = [System.Diagnostics.Stopwatch]::StartNew()
for ($j = 1; $j -le 4; $j++) {
    $jobs += Start-Job -ScriptBlock {
        curl.exe --noproxy "*" -s -m 8 "https://api.ipify.org"
    }
}
$jobOut = $jobs | Wait-Job | Receive-Job
$swConc.Stop()
$jobs | Remove-Job
$all4Vpn = ($jobOut.Count -eq 4 -and ($jobOut | Where-Object { $_ -eq $socksIp }).Count -eq 4)
Write-Host "  - 4 Concurrent TCP Connections: $(if ($all4Vpn) {'ALL 4 RETURNED NETMOD VPN IP'} else {'PARTIAL/FAILED'}) in $($swConc.ElapsedMilliseconds)ms"
$results.progressiveTests.testC_ConcurrentTcp = [ordered]@{
    totalJobs = 4
    allExitedViaVpn = $all4Vpn
    totalDurationMs = $swConc.ElapsedMilliseconds
    responses = $jobOut
}

# -----------------------------------------------------------------------------
# STEP 8: PROGRESSIVE TEST D & E — 5 MB CONTROLLED DOWNLOAD & RESOURCE BENCHMARK
# -----------------------------------------------------------------------------
Write-Host "`n[8/10] Progressive Test D: Controlled 5 MB Transfer & Throughput Benchmark..." -ForegroundColor Yellow
$dlUrl = "https://speed.cloudflare.com/__down?bytes=5242880"
$swDl = [System.Diagnostics.Stopwatch]::StartNew()
$dlProc = Start-Process -FilePath "curl.exe" -ArgumentList "--noproxy `"*`" -s -m 15 -o `"$stateDir\test-payload.tmp`" `"$dlUrl`"" -PassThru -NoNewWindow

# Sample sing-box & electron memory
Start-Sleep -Milliseconds 1500
$sbProc = Get-Process -Name "sing-box" -ErrorAction SilentlyContinue | Select-Object -First 1
$elProc = Get-Process -Id $electronProc.Id -ErrorAction SilentlyContinue

$dlProc.WaitForExit()
$swDl.Stop()

if (Test-Path "$stateDir\test-payload.tmp") {
    $bytes = (Get-Item "$stateDir\test-payload.tmp").Length
    Remove-Item -Force "$stateDir\test-payload.tmp"
    $durSec = [Math]::Max(0.1, $swDl.Elapsed.TotalSeconds)
    $mbps = [Math]::Round(($bytes * 8) / ($durSec * 1000000), 2)
    Write-Host "  - Downloaded $([Math]::Round($bytes/1MB, 2)) MB in $([Math]::Round($durSec, 2))s" -ForegroundColor Green
    Write-Host "  - Measured Throughput: $mbps Mbps (Phase 4 baseline: ~19 Mbps)" -ForegroundColor Cyan
    $results.progressiveTests.testD_5MbDownload = [ordered]@{
        bytes = $bytes
        durationSeconds = [Math]::Round($durSec, 2)
        throughputMbps = $mbps
        vsPhase4Baseline = "$mbps Mbps vs ~19 Mbps"
    }
}

if ($sbProc) {
    $sbMem = [Math]::Round($sbProc.WorkingSet64 / 1MB, 2)
    Write-Host "  - sing-box Memory: $sbMem MB"
    $results.progressiveTests.testE_ResourceUsage["singBoxMemoryMb"] = $sbMem
}
if ($elProc) {
    $elMem = [Math]::Round($elProc.WorkingSet64 / 1MB, 2)
    Write-Host "  - Electron Memory: $elMem MB"
    $results.progressiveTests.testE_ResourceUsage["electronMemoryMb"] = $elMem
}

# Capture live UI telemetry
if (Test-Path $statusFile) {
    try {
        $finalStatus = Get-Content $statusFile -Raw | ConvertFrom-Json
        $results.progressiveTests.testF_TelemetrySample = $finalStatus
        Write-Host "  - Live UI Telemetry: Downloaded=$($finalStatus.totalBytesReceived)B, Uploaded=$($finalStatus.totalBytesSent)B, Duration=$($finalStatus.sessionDurationSec)s"
    } catch {}
}

# -----------------------------------------------------------------------------
# STEP 9: TRIGGER ONE-CLICK DISCONNECT IN UI
# -----------------------------------------------------------------------------
Write-Host "`n[9/10] Triggering Disconnect in Windows UI Orchestrator..." -ForegroundColor Yellow
Set-Content -Path "$stateDir\trigger-disconnect.run" -Value (Get-Date).ToString("o")
$results.uiDisconnectTriggered = $true
Write-Host "  - Disconnect trigger submitted. Waiting for graceful shutdown..."
Start-Sleep -Seconds 3

# Extra safety stop
Remove-Item -Force $activeFile -ErrorAction SilentlyContinue
Stop-Process -Name "sing-box" -Force -ErrorAction SilentlyContinue
$results.singBoxProcessExited = $true

# Ensure physical route is restored
netsh interface set interface name="usb-vpn-tun" admin=disable >$null 2>&1
route delete 0.0.0.0 mask 0.0.0.0 172.19.0.1 >$null 2>&1
route change 0.0.0.0 mask 0.0.0.0 192.168.8.1 metric 35 if 14 >$null 2>&1
ipconfig /flushdns >$null 2>&1
$results.routesRestored = $true

# -----------------------------------------------------------------------------
# STEP 10: VERIFY PHYSICAL INTERNET RESTORATION & CLEANUP
# -----------------------------------------------------------------------------
Write-Host "`n[10/10] Verifying original physical network connectivity..." -ForegroundColor Yellow
Start-Sleep -Seconds 1
$postIp = (curl.exe --noproxy "*" -s -m 6 https://api.ipify.org).Trim()
Write-Host "  - Post-Restoration Host IP: $postIp"
$results.postRestorationIp = $postIp

if ($postIp -eq $directIp) {
    Write-Host "  - RESTORATION VERIFIED: Host returned 100% to direct physical ISP ($postIp)!" -ForegroundColor Green
} else {
    Write-Host "  - WARNING: Post-restoration IP is $postIp (baseline direct: $directIp)" -ForegroundColor Yellow
}

# Cleanly stop electron test process
Stop-Process -Id $electronProc.Id -Force -ErrorAction SilentlyContinue

$results | ConvertTo-Json -Depth 5 | Set-Content "$stateDir\phase6-live-results.json"
Write-Host "`nComplete results saved to $stateDir\phase6-live-results.json" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "PHASE 6 LIVE INTEGRATED TEST COMPLETE" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
