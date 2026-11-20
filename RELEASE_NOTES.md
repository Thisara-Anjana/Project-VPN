# USB VPN BRIDGE — RELEASE NOTES
## Personal Beta Release (v1.0.0-beta)

**Release Date:** November 19, 2026  
**Target Architecture:** Windows 11 64-bit & Android 16 (ARM64)  
**Hardware Verified:** Nothing Phone (2a) & Windows 11 AMD64 PC  
**Project Root:** `G:\Project VPN`

---

## 1. What is USB VPN Bridge?

USB VPN Bridge is a non-root, PdaNet+/Tetrd-style Android-to-Windows USB internet tethering system. It solves the critical limitation of standard mobile tethering by routing 100% of Windows PC TCP internet traffic through your Android phone's active mobile VPN client (**NetMod VPN**) over a single USB cable.

No browser proxy settings, manual socks caps, or complex network commands are required on Windows.

---

## 2. Key Features & Verified Capabilities

- **One-Click Connect/Disconnect**: Unified desktop interface with a large dynamic button automating the 15-step connection and teardown sequence.
- **Full-PC System-Wide TCP Tethering**: Browsers, game launchers, terminal tools, and Windows background services automatically route through the phone's VPN tunnel.
- **NetMod VPN Compatibility**: Preserves active Shadowsocks/V2Ray tunnels on Android (`tun0`) without terminating or conflicting with mobile VPN services.
- **High-Performance USB Relay**: Achieved **11.33 Mbps** sustained throughput over USB with 4 concurrent TCP connections during live testing.
- **Enterprise-Grade Network Engine**: Powered by official `sing-box v1.14.4` (amd64) and WireGuard LLC's `Wintun v0.14.1` virtual TUN driver.
- **Strict Route-Loop Prevention**: TUN MTU 1500 bytes; strict IP routing exclusions for `127.0.0.0/8`, `adb.exe`, and physical gateway (`192.168.8.1/32`).
- **Fail-Closed Teardown & Independent Recovery**: Disconnecting restores physical routes and flushes DNS caches. Standalone emergency scripts (`restore-routes.bat` and `restore-routes.ps1`) are available if the application ever terminates abnormally.
- **Real-Time Telemetry & Diagnostics**: Live 5-badge status bar (USB Control, Android Proxy, Windows Tunnel, Internet Sharing, VPN Routing) and 5-card live metrics grid (speeds, data transfer, duration).

---

## 3. Included Binaries & Release Artifacts

| Binary Artifact | Target Platform | Description |
| :--- | :--- | :--- |
| **`USB-VPN-Bridge-Setup-Beta.exe`** | Windows 11 x64 | Full NSIS Desktop Installer with shortcuts and bundled native binaries |
| **`USB-VPN-Bridge-Android-Beta.apk`** | Android 8.0+ (ARM64) | Installable Android client with background Foreground Service & SOCKS5 relay |
| **`BETA_INSTALLATION_GUIDE.md`** | All | Step-by-step installation, daily usage, and troubleshooting documentation |
| **`SHA256SUMS.txt`** | All | SHA-256 integrity checksum manifest for all release files |

---

## 4. Known Limitations (Beta Scope)

1. **Protocol Scope**: Full system TCP traffic is supported. Non-DNS UDP traffic is safely blocked to prevent cellular leakage. Applications requiring peer-to-peer UDP may fall back to TCP or have limited functionality.
2. **IPv6 Policy**: IPv6 traffic is blackholed locally to prevent leakage outside of NetMod's IPv4 tunnel.
3. **SmartScreen Prompt**: This is an unsigned personal beta release without an enterprise EV certificate; click *"More info"* $\rightarrow$ *"Run anyway"* when prompted by Windows SmartScreen.
4. **Target Hardware**: Validated specifically on the Nothing Phone (2a) and Windows 11 AMD64 PC. Multi-device compatibility is deferred to future releases.
