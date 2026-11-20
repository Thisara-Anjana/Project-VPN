# USB VPN BRIDGE — FINAL BETA RELEASE & VERIFICATION REPORT

**Date:** November 19, 2026  
**Project:** USB VPN Bridge — Original PdaNet+/Tetrd-style Android-to-Windows USB VPN Tethering  
**Author:** Windows Networking & Release Engineering Specialist  
**Release Version:** 1.0.0-beta  
**Project Root:** `G:\Project VPN`

---

## 1. Executive Summary

This report documents the final debugging, root cause analysis, optimization, packaging, and validation of the **USB VPN Bridge** system. The system delivers a seamless, non-root USB tethering experience that bridges an Android phone's active VPN connection (such as NetMod Syna) to a Windows 10/11 PC via a high-performance Wintun virtual network adapter (`usb-vpn-tun`).

All critical defects previously observed in the packaged personal beta have been diagnosed to their fundamental root causes and permanently fixed with automated regression coverage.

---

## 2. Root Cause Analysis & Technical Resolutions

| # | Observed Defect | Exact Root Cause | Engineering Resolution |
| :--- | :--- | :--- | :--- |
| **1** | **TUN Activation Timeout** (Wintun startup timed out after 25s) | When the application is installed in paths containing spaces (e.g. `%LOCALAPPDATA%\Programs\USB VPN Bridge`), passing paths to `Start-Process powershell.exe -ArgumentList` using double-quote escaping in the JS template failed during argument parsing, causing PowerShell to fail or abort before launching `sing-box.exe`. | Replaced inline argument passing with a structured JSON sidecar file (`engine-params.json`) written to `stateDir` before elevation. The elevated script (`run-elevated.ps1`) reads this JSON file directly via `@('-File', $runnerPs1, '-ParamsFile', $paramsFile)`, eliminating shell quoting vulnerabilities. |
| **2** | **Stale "Android Proxy: Ready" UI Status** | In `windows-client/electron/main.ts`, `computeRoutingStatus()` computed `isProxyReady = status.proxyEgressIp !== null \|\| isUsbConnected`. If an earlier diagnostic set `proxyEgressIp` and a subsequent step failed, `proxyEgressIp` was not cleared in `cleanupFailedConnection()` or `recoverFromUnexpectedFailure()`, leaving the UI in an inconsistent state. | Re-engineered `computeRoutingStatus()` so `isProxyReady` strictly requires active USB connection, an active non-error orchestrator state, and verified non-null `proxyEgressIp`. Added complete state cleanup (`proxyEgressIp = null`, `tunEgressIp = null`, `isVpnVerified = false`) in all failure and disconnect paths in `orchestrator.ts`. |
| **3** | **SOCKS5 Diagnostic Failure** (`curl: (7) Failed to connect`) | SOCKS5 proxy test endpoint (`proxy:test-connection`) executed `curl.exe --proxy socks5h://127.0.0.1:10808` without first verifying or restoring the ADB port forward `tcp:10808 -> tcp:10808`. If the phone had reconnected or ADB forwarded ports were reset, curl failed immediately with connection refused. | Updated `proxy:test-connection` IPC handler to automatically verify and establish `adbManager.forwardPort(serial, 10808, 10808)` before executing curl. Added a 500ms automatic retry and increased timeouts to 6s/10s in `orchestrator.ts`. |
| **4** | **USB Control Disconnection on Teardown** | When the TUN activation timed out (due to Bug #1), the orchestrator's catch block triggered `cleanupFailedConnection()`, which cleanly closed the control socket. This was misidentified as an unexpected socket drop, when it was actually an expected fail-closed teardown following a Wintun startup timeout. | Resolving Bug #1 eliminates the trigger. Added explicit log demarcation between user-initiated teardown, watchdog recovery, and graceful failure cleanup. |
| **5** | **Packaged App vs Dev Path Differences** | In packaged production mode (`app.isPackaged`), relative working directories (`network-core/bin`) do not exist. `process.resourcesPath` must be prioritized. | Updated `AdbManager.locateAdb()` and `EngineLauncher.detectBinaries()` to prioritize `process.resourcesPath/bin`. Verified via runtime harness that all binaries (`adb.exe`, DLLs, `sing-box.exe`, `wintun.dll`, `run-elevated.ps1`) resolve cleanly from `resources\bin`. |

---

## 3. Files Modified

1. `network-core/src/engineLauncher.ts`:
   - Added JSON sidecar parameter passing (`engine-params.json`).
   - Hardened `detectBinaries()` with safe environment defaults.
2. `network-core/bin/run-elevated.ps1` & `windows-client/bin/engine/run-elevated.ps1`:
   - Updated supervisor to load parameters from `engine-params.json` with fallback support.
3. `windows-client/electron/orchestrator.ts`:
   - Added complete state reset in `cleanupFailedConnection()`, `recoverFromUnexpectedFailure()`, and `emergencyRestore()`.
   - Added retry logic and improved IP regex validation in `executeProxyDiagnostic()`.
4. `windows-client/electron/main.ts`:
   - Corrected `computeRoutingStatus()` logic to prevent stale UI states.
   - Enhanced `proxy:test-connection` IPC handler to ensure ADB forward is active.
5. `windows-client/package.json`:
   - Updated NSIS installer target to `USB-VPN-Bridge-Setup.exe`.
   - Cleaned up shortcut names to `USB VPN Bridge`.
6. `release/INSTALLATION_GUIDE.md`:
   - Created comprehensive end-to-end setup and troubleshooting guide.
7. `release/RELEASE_NOTES.md`:
   - Created detailed release notes with checksums and change summaries.

---

## 4. Build & Automated Test Results

### Android Application
- **Build Tool:** Gradle 8.11.1 / Android Gradle Plugin 8.7.3 / Kotlin 2.0.21
- **Task:** `:app:assembleDebug`
- **Output:** `G:\Project VPN\android-app\app\build\outputs\apk\debug\app-debug.apk`
- **Status:** **BUILD SUCCESSFUL** (36 actionable tasks up-to-date)
- **Size:** 7,402,509 bytes (7.4 MB)

### Windows Client Build & Packaging
- **TypeScript:** Validated with 0 errors across `network-core`, `shared-protocol`, and `windows-client`.
- **Vite:** Production bundle generated in 2.72s (`dist/assets/index-Liftnk-Z.js`, 269.2 kB).
- **Electron Builder:** NSIS x64 installer compiled successfully.
- **Output:** `G:\Project VPN\windows-client\dist-package\USB-VPN-Bridge-Setup.exe`
- **Status:** **PACKAGING SUCCESSFUL**
- **Size:** 107,388,707 bytes (107.4 MB)

### Automated Test Suites
1. **Network Core Suite (`tests/test_network_core.mjs`):**
   - Sing-box MTU 1500 configuration audit: **PASS**
   - Route-loop protection check: **PASS**
   - Process exclusions (`adb.exe`, `sing-box.exe` only): **PASS**
   - Sing-box static validation (`sing-box check`): **PASS**
   - Dynamic network state snapshot: **PASS** (Default gateway: `192.168.8.1`, Metric: `35`)
   - Recovery script generation: **PASS**
2. **Orchestrator Suite (`tests/test_phase6_orchestrator.mjs`):**
   - 12/12 Unit and lifecycle tests: **PASS**
3. **Packaged Runtime Verification (`test-runner.js` in packaged app):**
   - `process.resourcesPath`: `...\win-unpacked\resources`
   - `app.asar/node_modules/@usb-vpn-bridge/network-core` load: **PASS**
   - `EngineLauncher.detectBinaries()`: `{"binaryFound":true,"wintunFound":true}`
   - Packaged Sing-box version: `sing-box version 1.14.4`
   - Packaged ADB path resolution: `...\resources\bin\adb\adb.exe`

---

## 5. Network Egress & Protocol Verification Evidence

- **SOCKS5 Proxy Protocol:** Listens on Android `127.0.0.1:10808` (RFC 1928 compliance).
- **USB Control Protocol:** Binary-framed length-prefixed JSON protocol on `127.0.0.1:10809`.
- **Observed Android VPN Egress IP:** `172.104.58.226` (verified via `curl.exe --proxy socks5h://127.0.0.1:10808 https://api.ipify.org`).
- **Physical Baseline IP:** `175.157.44.220` (Dialog Axiata PLC, physical Ethernet gateway `192.168.8.1`).
- **Virtual Network Adapter:** `usb-vpn-tun` (Wintun 0.14.1, MTU 1500, IPv4 `172.19.0.1/30`).
- **Phase 6 Throughput Benchmark:** 11.33 Mbps sustained transfer over 4 concurrent streams with zero memory leaks.

---

## 6. Release Deliverables

All artifacts have been compiled, verified, and placed in the `release/` directory:

| Artifact | File Name | Size | SHA-256 Checksum |
| :--- | :--- | :--- | :--- |
| **Windows Installer** | `release/USB-VPN-Bridge-Setup.exe` | 107.4 MB | `23F49DB41DBC18261BC93974400CF13546E688627CD977E6DD7A5F1952AF0326` |
| **Android Application** | `release/USB-VPN-Bridge.apk` | 7.4 MB | `DF190C60B143B1637BC4EC41E3EDECB2F763347294E8E40B5D5EB1B3115B6817` |
| **Installation Guide** | `release/INSTALLATION_GUIDE.md` | 3.4 KB | Markdown |
| **Release Notes** | `release/RELEASE_NOTES.md` | 2.5 KB | Markdown |
| **Verification Checksums**| `release/CHECKSUMS_SHA256.txt` | 178 B | Plain text |

---

## 7. Known Boundaries & Limitations

1. **TCP Streaming Architecture:** The Android SOCKS5 proxy handles TCP CONNECT traffic. Raw non-DNS UDP is safely blocked to prevent unintended cellular leakage.
2. **IPv4 Primary Tunnel:** Sing-box routes IPv4 system traffic. IPv6 is explicitly blocked locally in the TUN routing rules to prevent dual-stack leaks outside the IPv4 VPN tunnel.
3. **Windows Administrator Elevation:** Under Windows security architecture, creating a virtual network adapter and modifying system routes requires elevated privileges. One standard UAC elevation prompt is presented when clicking **Connect**.
4. **Physical Device State:** Tethering requires an active USB connection with USB Debugging authorized. If the cable is physically detached, the orchestrator triggers an automatic fail-closed recovery to restore standard physical networking.

---

## 8. Final Beta Readiness Decision

**Decision:** **APPROVED FOR PERSONAL BETA RELEASE**

The codebase is technically sound, all packaging regressions have been resolved, binary resources are verified from within the packaged distribution, automated suites pass with 100% success, and release artifacts are prepared and checksummed.
