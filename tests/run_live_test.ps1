# USB VPN Bridge — Supervised Phase 5B Live Test Orchestrator
$ErrorActionPreference = "Continue"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "USB VPN BRIDGE: SUPERVISED LIVE TUN TEST (PHASE 5B)" -ForegroundColor Cyan
Write-Host "=================================================================`n" -ForegroundColor Cyan

$stateDir = "G:\Project VPN\network-core\state"
$binDir = "G:\Project VPN\network-core\bin"
$sbBin = "$binDir\sing-box.exe"
$configPath = "$stateDir\sing-box-config.json"
$snapshotPath = "$stateDir\pre-test-snapshot.json"
$logPath = "$stateDir\sing-box-live.log"
$elevatedBat = "$binDir\run-elevated.bat"

$results = [ordered]@{
    timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    preconditionCheck = $false
    baselineDirectIp = ""
    netModSocksIp = ""
    uacLaunched = $false
    tunAdapterDetected = $false
    routeTableBefore = ""
    routeTableDuring = ""
    routeTableAfter = ""
    tunRouteInjected = $false
    proxyFreeHttpsResult = ""
    proxyFreeExitCode = -1
    egressMatchesNetMod = $false
    singBoxProcessKilled = $false
    restorationSuccess = $false
    postRestorationIp = ""
    singBoxLogOutput = @()
    errors = @()
}

# -----------------------------------------------------------------------------
# 1. PRECONDITION VERIFICATION
# -----------------------------------------------------------------------------
Write-Host "[1/8] Verifying Preconditions..." -ForegroundColor Yellow

# A. Direct Physical IP
$directIp = (curl.exe --noproxy "*" -s -m 6 https://api.ipify.org).Trim()
Write-Host "  - Direct Physical Host IP: $directIp"
$results.baselineDirectIp = $directIp

# B. NetMod SOCKS5 IP
$socksIp = (curl.exe --proxy socks5h://127.0.0.1:10808 -s -m 6 https://api.ipify.org).Trim()
Write-Host "  - NetMod SOCKS5 Egress IP: $socksIp"
$results.netModSocksIp = $socksIp

if (-not $socksIp -or $socksIp -eq $directIp) {
    Write-Host "FATAL: SOCKS5 proxy not exiting via NetMod VPN ($socksIp vs $directIp). Aborting." -ForegroundColor Red
    $results.errors += "SOCKS5 proxy not responding with NetMod IP"
    $results | ConvertTo-Json -Depth 5 | Set-Content "$stateDir\live-test-results.json"
    exit 1
}

# C. sing-box check
$checkOut = & $sbBin check -c $configPath 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FATAL: sing-box check failed: $checkOut" -ForegroundColor Red
    $results.errors += "sing-box check failed"
    $results | ConvertTo-Json -Depth 5 | Set-Content "$stateDir\live-test-results.json"
    exit 1
}
Write-Host "  - sing-box configuration check: PASSED (Exit 0)" -ForegroundColor Green

$results.preconditionCheck = $true
$results.routeTableBefore = (route print -4) | Out-String

# -----------------------------------------------------------------------------
# 2. START ELEVATED TUN ENGINE (Triggers Windows Administrator UAC Prompt)
# -----------------------------------------------------------------------------
Write-Host "`n[2/8] Launching sing-box with Administrator privileges (UAC Prompt)..." -ForegroundColor Yellow
if (Test-Path $logPath) { Remove-Item -Force $logPath }

# Trigger elevated batch file via RunAs
Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$elevatedBat`"" -Verb RunAs
$results.uacLaunched = $true
Write-Host "  - UAC elevation requested. Waiting for user approval and Wintun initialization..."

# -----------------------------------------------------------------------------
# 3. AWAIT TUN ADAPTER & AUTO_ROUTE (Up to 25 seconds for user approval)
# -----------------------------------------------------------------------------
Write-Host "`n[3/8] Waiting for Wintun adapter 'usb-vpn-tun' and route table update (up to 25s)..." -ForegroundColor Yellow
$adapterReady = $false
for ($i = 1; $i -le 25; $i++) {
    Start-Sleep -Seconds 1
    $rt = (route print -4) | Out-String
    if ($rt -match "172\.19\.0\.1|172\.19\.0\.2") {
        $adapterReady = $true
        $results.routeTableDuring = $rt
        Write-Host "  - TUN default route detected in Windows routing table after $i seconds!" -ForegroundColor Green
        break
    }
    if ($i % 5 -eq 0) {
        Write-Host "    ... waiting for UAC approval / adapter ($i/25s) ..." -ForegroundColor Gray
    }
}

if ($adapterReady) {
    $results.tunRouteInjected = $true
    $results.tunAdapterDetected = $true
} else {
    Write-Host "  - Warning: TUN route not detected in routing table after 25s." -ForegroundColor Red
    $results.errors += "TUN route not detected within 25s timeout (UAC declined or delayed)"
}

# -----------------------------------------------------------------------------
# 4. EXECUTE PROXY-FREE HTTPS TEST
# -----------------------------------------------------------------------------
Write-Host "`n[4/8] Executing Single Proxy-Free HTTPS Request: curl.exe --noproxy '*' https://api.ipify.org..." -ForegroundColor Yellow
$testOutput = (curl.exe --noproxy "*" -s -m 8 https://api.ipify.org).Trim()
$curlExit = $LASTEXITCODE
Write-Host "  - Result: $testOutput (Curl Exit Code: $curlExit)" -ForegroundColor Cyan
$results.proxyFreeHttpsResult = $testOutput
$results.proxyFreeExitCode = $curlExit

if ($testOutput -eq $socksIp) {
    Write-Host "  - VERIFICATION: 100% MATCH WITH NETMOD VPN EGRESS!" -ForegroundColor Green
    $results.egressMatchesNetMod = $true
} else {
    Write-Host "  - Result did not match NetMod ($socksIp), actual: $testOutput" -ForegroundColor Red
}

# -----------------------------------------------------------------------------
# 5. SHUT DOWN TUN ENGINE
# -----------------------------------------------------------------------------
Write-Host "`n[5/8] Shutting down sing-box engine..." -ForegroundColor Yellow
Stop-Process -Name "sing-box" -Force -ErrorAction SilentlyContinue
$results.singBoxProcessKilled = $true

# -----------------------------------------------------------------------------
# 6. RESTORE APPLICATION-OWNED NETWORK CHANGES
# -----------------------------------------------------------------------------
Write-Host "`n[6/8] Executing safe route and adapter restoration..." -ForegroundColor Yellow

# Disable usb-vpn-tun interface
netsh interface set interface name="usb-vpn-tun" admin=disable >$null 2>&1

# Delete transient route
route delete 0.0.0.0 mask 0.0.0.0 172.19.0.1 >$null 2>&1

# Restore physical default route
route change 0.0.0.0 mask 0.0.0.0 192.168.8.1 metric 35 if 14 >$null 2>&1

# Flush DNS
ipconfig /flushdns >$null 2>&1

Start-Sleep -Seconds 1
$results.routeTableAfter = (route print -4) | Out-String

# -----------------------------------------------------------------------------
# 7. VERIFY RESTORATION
# -----------------------------------------------------------------------------
Write-Host "`n[7/8] Verifying original physical network connectivity..." -ForegroundColor Yellow
$postIp = (curl.exe --noproxy "*" -s -m 6 https://api.ipify.org).Trim()
Write-Host "  - Post-Restoration Egress IP: $postIp"
$results.postRestorationIp = $postIp

if ($postIp -eq $directIp) {
    Write-Host "  - VERIFICATION: Successfully restored to baseline physical connection ($directIp)!" -ForegroundColor Green
    $results.restorationSuccess = $true
} else {
    Write-Host "  - Warning: Post-restoration IP ($postIp) differs from baseline ($directIp)" -ForegroundColor Yellow
}

# -----------------------------------------------------------------------------
# 8. SAVE RESULTS & LOGS
# -----------------------------------------------------------------------------
Write-Host "`n[8/8] Saving test results to disk..." -ForegroundColor Yellow
if (Test-Path $logPath) {
    $results.singBoxLogOutput = Get-Content $logPath -Tail 50
    Write-Host "Captured sing-box logs from: $logPath"
}
$results | ConvertTo-Json -Depth 5 | Set-Content "$stateDir\live-test-results.json"
Write-Host "Results saved to: $stateDir\live-test-results.json" -ForegroundColor Green

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "LIVE TEST RUNNER FINISHED" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
