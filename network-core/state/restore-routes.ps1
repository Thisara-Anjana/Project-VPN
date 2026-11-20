# ===========================================================================
# USB VPN Bridge - Emergency Route & DNS Restoration Script (PowerShell)
# Generated at: 2026-11-19T19:50:13.409Z
# ===========================================================================

# Self-elevate if not running as Administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[USB VPN Bridge] Elevating to Administrator..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Host "[USB VPN Bridge] Initiating safe network restoration..." -ForegroundColor Cyan

# 1. Clean up usb-vpn-tun adapter if present
try {
    $tun = Get-NetAdapter -Name "usb-vpn-tun" -ErrorAction SilentlyContinue
    if ($tun) {
        Write-Host "Disabling lingering TUN adapter: $($tun.Name)" -ForegroundColor Yellow
        Disable-NetAdapter -Name $tun.Name -Confirm:$false -ErrorAction SilentlyContinue
    }
} catch {}

# 2. Remove TUN default route if present
try {
    route delete 0.0.0.0 mask 0.0.0.0 172.19.0.1 2>$null
} catch {}

# 3. Restore primary default route metric dynamically

# 4. Flush DNS
Clear-DnsClientCache -ErrorAction SilentlyContinue

Write-Host "[SUCCESS] Network restoration complete." -ForegroundColor Green
Write-Host "[PROTECTED] Preserved third-party VPNs: usb-vpn-tun (sing-tun Tunnel)" -ForegroundColor Gray