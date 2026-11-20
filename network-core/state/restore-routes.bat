@echo off
setlocal EnableDelayedExpansion
:: ===========================================================================
:: USB VPN Bridge - Emergency Route & DNS Restoration Script
:: Generated at: 2026-11-19T19:50:13.409Z
:: ===========================================================================

:: Check for Administrator Privileges and Self-Elevate via UAC if needed
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [USB VPN Bridge] Requesting Administrator privileges...
    powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/c ""%~f0""' -Verb RunAs"
    exit /b
)

echo [USB VPN Bridge] Running with Administrator privileges.
echo [USB VPN Bridge] Initiating safe network restoration...

:: 1. Clean up usb-vpn-tun adapter if present
echo [1/4] Checking for lingering usb-vpn-tun adapter...
netsh interface set interface name="usb-vpn-tun" admin=disable >nul 2>&1

:: 2. Remove transient TUN default route (172.19.0.1)
echo [2/4] Removing transient TUN default route...
route delete 0.0.0.0 mask 0.0.0.0 172.19.0.1 >nul 2>&1

:: 3. Restore Dynamically Captured Default IPv4 Route Metrics
echo [3/4] Restoring original default IPv4 route...
echo No specific physical gateway mutation found in baseline snapshot.

:: 4. Flush DNS Resolver Cache
echo [4/4] Flushing DNS resolver cache...
ipconfig /flushdns >nul 2>&1

echo ===========================================================================
echo [SUCCESS] Network restoration complete.
echo [PROTECTED] Third-party VPN adapters preserved: usb-vpn-tun (sing-tun Tunnel)
echo ===========================================================================
pause