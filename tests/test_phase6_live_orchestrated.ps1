# ===========================================================================
# USB VPN Bridge — Phase 6: Live One-Click Orchestration & Sustained Testing
# ===========================================================================
$ErrorActionPreference = "Continue"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "USB VPN BRIDGE — PHASE 6: LIVE ONE-CLICK SUSTAINED TEST" -ForegroundColor Cyan
Write-Host "=================================================================`n" -ForegroundColor Cyan

$stateDir = "G:\Project VPN\network-core\state"
$binDir = "G:\Project VPN\network-core\bin"
$elevatedBat = "$binDir\run-elevated.bat"
$activeFile = "$stateDir\engine.active"
$logPath = "$stateDir\sing-box-live.log"

$results = [ordered]@{
    timestamp = (Get-Date).ToString("o")
    preconditionCheck = $false
    baselineDirectIp = ""
    netModSocksIp = ""
    tunAdapterDetected = $false
    tunEgressIp = ""
    egressMatchesNetMod = $false
    testA_Browsing = @{}
    testC_Concurrent = @{}
    testD_ShortTransfer = @{}
    testE_SustainedTransfer = @{}
    testF_CpuMemory = @{}
    disconnectRestored = $false
    postRestorationIp = ""
    errors = @()
}

# 1. Precondition Check
Write-Host "[1/7] Checking Preconditions..." -ForegroundColor Yellow
$directIp = (curl.exe --noproxy "*" -s -m 6 https://api.ipify.org).Trim()
$results.baselineDirectIp = $directIp
Write-Host "  - Physical ISP IP: $directIp"

$socksIp = (curl.exe --proxy socks5h://127.0.0.1:10808 -s -m 6 https://api.ipify.org).Trim()
$results.netModSocksIp = $socksIp
Write-Host "  - Android NetMod SOCKS5 IP: $socksIp"

if (-not $socksIp -or $socksIp -eq $directIp) {
    Write-Host "ERROR: NetMod SOCKS5 proxy not responding or matches direct ISP. Aborting." -ForegroundColor Red
    $results.errors += "SOCKS5 proxy invalid"
    $results | ConvertTo-Json -Depth 5 | Set-Content "$stateDir\phase6-live-results.json"
    exit 1
}
$results.preconditionCheck = $true

# 2. Start Elevated TUN Engine
Write-Host "`n[2/7] Launching Elevated TUN Engine (UAC Supervisor)..." -ForegroundColor Yellow
if (Test-Path $logPath) { Remove-Item -Force $logPath }
Set-Content -Path $activeFile -Value (Get-Date).ToString("o")

Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$elevatedBat`"" -Verb RunAs

# Wait for adapter up to 25s
$adapterReady = $false
for ($i = 1; $i -le 25; $i++) {
    Start-Sleep -Seconds 1
    $rt = (route print -4) | Out-String
    if ($rt -match "172\.19\.0\.1|172\.19\.0\.2") {
        $adapterReady = $true
        $results.tunAdapterDetected = $true
        Write-Host "  - Virtual adapter 'usb-vpn-tun' active in routing table ($i seconds)." -ForegroundColor Green
        break
    }
}

if (-not $adapterReady) {
    Write-Host "ERROR: TUN adapter failed to activate. Aborting." -ForegroundColor Red
    Remove-Item -Force $activeFile -ErrorAction SilentlyContinue
    exit 1
}

# 3. Verify Proxy-Free Egress
Write-Host "`n[3/7] Verifying Proxy-Free Windows Egress..." -ForegroundColor Yellow
$tunIp = (curl.exe --noproxy "*" -s -m 8 https://api.ipify.org).Trim()
Write-Host "  - Proxy-Free Egress IP: $tunIp"
$results.tunEgressIp = $tunIp

if ($tunIp -eq $socksIp) {
    Write-Host "  - VERIFIED: Windows traffic routes 100% through NetMod Singapore VPN!" -ForegroundColor Green
    $results.egressMatchesNetMod = $true
} else {
    Write-Host "  - WARNING: Egress IP ($tunIp) differs from baseline ($socksIp)." -ForegroundColor Red
}

# 4. Progressive Test A: Multi-Host Browsing
Write-Host "`n[4/7] Progressive Test A: Multi-Host HTTPS Endpoints..." -ForegroundColor Yellow
$endpoints = @(
    "https://api.ipify.org",
    "https://cloudflare.com/cdn-cgi/trace",
    "https://httpbin.org/ip"
)
foreach ($ep in $endpoints) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $res = curl.exe --noproxy "*" -s -m 6 $ep
    $sw.Stop()
    $success = ($LASTEXITCODE -eq 0 -and $res.Length -gt 0)
    Write-Host "  - $ep: $(if ($success) {'OK'} else {'FAIL'}) ($($sw.ElapsedMilliseconds)ms)"
    $results.testA_Browsing[$ep] = @{
        success = $success
        latencyMs = $sw.ElapsedMilliseconds
    }
}

# 5. Progressive Test C: Concurrent TCP Connections
Write-Host "`n[5/7] Progressive Test C: 4 Concurrent HTTPS TCP Connections..." -ForegroundColor Yellow
$jobs = @()
$concurrentSw = [System.Diagnostics.Stopwatch]::StartNew()
for ($j = 1; $j -le 4; $j++) {
    $jobs += Start-Job -ScriptBlock {
        curl.exe --noproxy "*" -s -m 8 "https://api.ipify.org"
    }
}
$jobResults = $jobs | Wait-Job | Receive-Job
$concurrentSw.Stop()
$jobs | Remove-Job
$allPassed = ($jobResults.Count -eq 4 -and ($jobResults | Where-Object { $_ -eq $socksIp }).Count -eq 4)
Write-Host "  - 4 Concurrent TCP Connections: $(if ($allPassed) {'ALL 4 RETURNED NETMOD VPN IP'} else {'PARTIAL'}) in $($concurrentSw.ElapsedMilliseconds)ms"
$results.testC_Concurrent = @{
    jobs = 4
    allExitedViaVpn = $allPassed
    totalTimeMs = $concurrentSw.ElapsedMilliseconds
}

# 6. Progressive Test D: Controlled Download Throughput (5MB Payload)
Write-Host "`n[6/7] Progressive Test D: Controlled 5 MB Transfer & Throughput Benchmark..." -ForegroundColor Yellow
$downloadUrl = "https://speed.cloudflare.com/__down?bytes=5242880"
$swDl = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath "curl.exe" -ArgumentList "--noproxy `"*`" -s -m 15 -o `"$stateDir\test-payload.tmp`" `"$downloadUrl`"" -PassThru -NoNewWindow
$cpuSample = (Get-Process -Name "sing-box" -ErrorAction SilentlyContinue | Select-Object -Property CPU, WorkingSet64)
$proc.WaitForExit()
$swDl.Stop()

if (Test-Path "$stateDir\test-payload.tmp") {
    $fileBytes = (Get-Item "$stateDir\test-payload.tmp").Length
    Remove-Item -Force "$stateDir\test-payload.tmp"
    $durationSec = [Math]::Max(0.1, $swDl.Elapsed.TotalSeconds)
    $throughputMbps = [Math]::Round(($fileBytes * 8) / ($durationSec * 1000000), 2)
    Write-Host "  - Downloaded $([Math]::Round($fileBytes/1MB, 2)) MB in $([Math]::Round($durationSec, 2))s" -ForegroundColor Green
    Write-Host "  - Measured Throughput: $throughputMbps Mbps (Phase 4 baseline: ~19 Mbps)" -ForegroundColor Cyan
    $results.testD_ShortTransfer = @{
        bytes = $fileBytes
        durationSec = $durationSec
        throughputMbps = $throughputMbps
    }
} else {
    Write-Host "  - Download test failed or timed out." -ForegroundColor Red
}

if ($cpuSample) {
    $results.testF_CpuMemory = @{
        cpuSeconds = $cpuSample.CPU
        memoryMb = [Math]::Round($cpuSample.WorkingSet64 / 1MB, 2)
    }
    Write-Host "  - sing-box Memory: $([Math]::Round($cpuSample.WorkingSet64 / 1MB, 2)) MB"
}

# 7. Disconnect and Restore
Write-Host "`n[7/7] Disconnecting & Restoring Physical Routes..." -ForegroundColor Yellow
Remove-Item -Force $activeFile -ErrorAction SilentlyContinue
Stop-Process -Name "sing-box" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

netsh interface set interface name="usb-vpn-tun" admin=disable >$null 2>&1
route delete 0.0.0.0 mask 0.0.0.0 172.19.0.1 >$null 2>&1
route change 0.0.0.0 mask 0.0.0.0 192.168.8.1 metric 35 if 14 >$null 2>&1
ipconfig /flushdns >$null 2>&1

Start-Sleep -Seconds 1
$postIp = (curl.exe --noproxy "*" -s -m 6 https://api.ipify.org).Trim()
Write-Host "  - Post-Restoration Egress IP: $postIp"
$results.postRestorationIp = $postIp
if ($postIp -eq $directIp) {
    Write-Host "  - Clean restoration verified: host returned to direct physical ISP ($postIp)." -ForegroundColor Green
    $results.disconnectRestored = $true
} else {
    Write-Host "  - Note: Post-restoration IP is $postIp (baseline: $directIp)" -ForegroundColor Yellow
}

$results | ConvertTo-Json -Depth 5 | Set-Content "$stateDir\phase6-live-results.json"
Write-Host "`nResults saved to $stateDir\phase6-live-results.json" -ForegroundColor Cyan
