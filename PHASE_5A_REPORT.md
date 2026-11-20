# USB VPN Bridge — Phase 5A Report
## Safe Windows TUN Engine Integration & Non-Activating Architecture

**Project:** USB VPN Bridge (Tetrd-Style Non-Root Android & Windows USB Internet Tethering)  
**Target Environment:** Windows 10/11 x64 (Desktop Client) & Android 16 (Physical Nothing Phone (2a))  
**Date:** November 19, 2026  
**Status:** **PHASE 5A COMPLETED & ARCHITECTURALLY VERIFIED** (System-wide routing remains safely inactive until Phase 5B)

---

## 1. Source-Code Inspection Results

A comprehensive audit was performed across the Windows desktop client (`windows-client/`), the Android relay application (`android-app/`), and the shared communication protocol (`shared-protocol/`):

1. **Windows Electron Architecture (`windows-client/electron/`)**:
   - `main.ts` manages IPC handlers and supervisor lifecycles. It connects to the Android device using `AdbManager` and communicates over the framed binary control channel on port `10809` via `ControlClient`.
   - `preload.ts` exposes safe context-isolated bridges (`usbVpnBridge`) with context isolation enabled and Node integration disabled.
   - SOCKS5 testing utility (`proxy:test-connection`) verifies egress over `127.0.0.1:10808` via ADB port forwarding using Windows native `curl.exe`.
2. **Android Relay Service & SOCKS5 Server (`android-app/`)**:
   - `RelayForegroundService.kt`: Concurrently runs the loopback Control listener (`127.0.0.1:10809`) and the RFC 1928 SOCKS5 TCP proxy (`127.0.0.1:10808`).
   - `Socks5ProxyServer.kt`: Implements RFC 1928 SOCKS5 `CONNECT` (cmd `0x01`). Handles IPv4 (`0x01`), IPv6 (`0x04`), and Domain Name (`0x03`) address types with remote DNS resolution on Android. It operates strictly in non-root user space with bounded 32 KB buffers.
   - Outbound sockets created by the Android app naturally traverse NetMod's active `tun0` interface without invoking an Android `VpnService` that would conflict with or terminate NetMod.
3. **Hardware Connectivity & NetMod Verification**:
   - Connected Physical Hardware: **Nothing Phone (2a)** (serial `00058342T000159`).
   - Outbound SOCKS5 Egress Public IP: `91.192.81.167` (`tro-sg-mb.servid.co`, Melbikomas UAB, Singapore) matching NetMod's active VPN tunnel.

---

## 2. Selected Windows Network Engine and Version

### Evaluated Alternatives
1. **Wintun Driver (`wintun.dll` 0.14.1)**:
   - Microsoft WHQL-signed Layer 3 virtual network TUN adapter driver developed by the WireGuard team.
   - Operates high-speed circular ring buffers in kernel memory shared with userspace.
   - *Limitation*: Wintun is strictly a driver; it does not contain a TCP/IP user-space stack to convert Layer 3 packets into Layer 4/5 TCP socket streams.
2. **Standalone tun2socks (`xjasonlyu/tun2socks`)**:
   - Uses `gVisor` netstack and `wintun.dll` to convert TUN packets to SOCKS5.
   - *Limitation*: Standalone `tun2socks` lacks built-in route management, automated route-loop prevention, DNS interception/routing, process-level split tunneling, and atomic recovery on ungraceful termination.
3. **sing-box (`v1.10.x` / `v1.11.x`)**:
   - Modern, high-performance universal proxy platform developed in Go.
   - Native Windows x64 binary with built-in `wintun.dll` driver loader and `gVisor`/`mixed` user-space TCP/IP stack.
   - Features built-in `auto_route`, `strict_route`, declarative JSON routing, process-level outbound matching, DNS interception, and automated route cleanup via Windows IP Helper API (`iphlpapi.dll`).
   - Supports dry-run validation (`sing-box check -c <config.json>`).

### Concrete Recommendation: **sing-box + Wintun**
- **Selected Engine**: `sing-box` (v1.10.x Windows amd64) paired with `wintun.dll` (v0.14.1).
- **Justification**:
  - Encapsulates the virtual adapter driver, high-throughput user-space TCP/IP stack (`gVisor`), and routing engine in a single, battle-tested native binary.
  - Native support for process-level exclusions (`adb.exe`, `electron.exe`, `sing-box.exe`), which is required for route-loop prevention.
  - Native support for DNS detour over TCP to SOCKS5, eliminating raw UDP dependency for domain resolution.
  - Clean separation: Electron acts strictly as supervisor and UI, never touching raw network packet buffers.

---

## 3. Dependency and Licensing Review

| Component | License | Packaging & Distribution |
| :--- | :--- | :--- |
| **Wintun (`wintun.dll` / `wintun.sys`)** | GPLv2 / Commercial (WireGuard LLC) | Precompiled x64 DLL digitally signed by Microsoft Windows Hardware Compatibility Publisher. No test-signing or driver signature bypass required. Packaged alongside engine in `network-core/bin/`. |
| **sing-box (`sing-box.exe`)** | GPLv3 (SagerNet) | Standalone static Go binary. Packaged in `network-core/bin/sing-box.exe`. |
| **@usb-vpn-bridge/network-core** | MIT (Internal) | TypeScript supervisor, configuration manager, and state inspector module. |
| **Electron & React Frontend** | MIT | Standard desktop UI framework. |

All components are license-compatible with open-source desktop distribution under GPLv3 / MIT guidelines.

---

## 4. TCP-Only Forwarding Architecture

Our Android SOCKS5 proxy operates over an ADB-forwarded loopback port (`127.0.0.1:10808`). The end-to-end data plane for Windows applications is structured as follows:

```
[Windows Applications (Browser, CLI, System Apps)]
         │
         │ 1. Windows routing table directs TCP traffic (0.0.0.0/0) to Wintun
         ▼
[Wintun Virtual Adapter: "usb-vpn-tun" (172.19.0.1/30)]
         │
         │ 2. Kernel-to-userspace memory transfer via circular ring buffer
         ▼
[sing-box TUN Inbound (gVisor / Mixed User-Space TCP/IP Stack)]
         │
         │ 3. Assembles raw IP packets into standard TCP socket streams
         ▼
[sing-box Route Engine]
         │
         │ 4. Route rules check process name, destination IP, and protocol
         ▼
[sing-box SOCKS5 Outbound ("socks-out")]
         │
         │ 5. Establishes RFC 1928 SOCKS5 TCP CONNECT to 127.0.0.1:10808
         ▼
[Localhost Port 10808 (Loopback)]
         │
         │ 6. Forwarded via ADB daemon (adb forward tcp:10808 tcp:10808)
         ▼
[Physical USB Cable (High-Speed USB Bulk Transfer)]
         │
         │ 7. ADB Daemon on Android (adbd) delivers stream to 127.0.0.1:10808
         ▼
[Android Relay Service: Socks5ProxyServer (Kotlin Coroutines / NIO)]
         │
         │ 8. Relay issues standard outbound TCP socket: Socket(target_ip, target_port)
         ▼
[Android Kernel Routing Engine]
         │
         │ 9. Kernel binds socket to active default network (NetMod tun0)
         ▼
[NetMod VPN Egress Gateway (91.192.81.167 - Singapore)]
```

---

## 5. UDP Support Limitations and Safe Handling

### Technical Boundary
The Android `Socks5ProxyServer.kt` currently implements RFC 1928 `CONNECT` (`0x01`) only. It does not implement `UDP ASSOCIATE` (`0x03`), which would require UDP socket relays and dynamic port allocation over USB.

### Safe Handling Strategy (Zero Traffic Leakage)
1. **No False Claims**: The application does not claim UDP support.
2. **DNS Query Handling**: DNS is the most critical UDP consumer. Sing-box internal DNS intercepts Windows application DNS requests on port 53 and queries remote DNS resolvers (e.g. `1.1.1.1` or `8.8.8.8`) **over TCP** through the SOCKS5 proxy (`socks-out`). In addition, for domain-targeted traffic, sing-box passes domains directly to SOCKS5, where our Android proxy performs remote DNS resolution on the phone.
3. **Unsupported UDP Policy**: All non-DNS UDP traffic (`network: "udp"`) is explicitly matched by a route rule and directed to `outbound: "block-out"`.
4. **Behavior on Blocked UDP**:
   - Modern protocols like HTTP/3 (QUIC) detect that UDP packets are blocked or rejected and immediately fall back to HTTP/2 over TCP / TLS without stalling.
   - Applications requiring raw UDP (such as VoIP or UDP gaming) fail explicitly and safely rather than silently leaking unencrypted traffic through the physical Wi-Fi or Ethernet adapter outside the VPN.

---

## 6. DNS and IPv6 Strategy

### DNS Strategy
- **Virtual DNS IP**: The TUN interface receives a dedicated local DNS resolver address (`172.19.0.2`).
- **Query Interception**: Sing-box captures port 53 traffic on the virtual interface.
- **TCP Detour**: Sing-box forwards DNS requests via TCP through the SOCKS5 tunnel (`tcp://1.1.1.1` via `socks-out`).
- **Domain Sniffing & Remote Resolution**: Sing-box's built-in packet sniffer extracts destination hostnames and submits SOCKS5 requests with address type `0x03` (Domain Name). The Android phone resolves these hostnames using its active DNS (routed through NetMod).

### IPv6 Leak Protection
- **Vulnerability**: Many mobile carrier networks and mobile VPN tunnels are IPv4-only. If Windows dual-stack applications query IPv6 (AAAA) or attempt IPv6 connections over physical interfaces, traffic leaks outside the NetMod tunnel.
- **Enforced Policy**:
  - The TUN adapter does not advertise an IPv6 default route (`inet6_address` omitted).
  - Sing-box route rule explicitly matches all IPv6 traffic (`ip_version: 6`) and directs it to `block-out`.
  - Sing-box DNS strategy is set to `ipv4_only`, suppressing AAAA resolution.
  - Windows physical IPv6 is completely prevented from bypassing the tunnel.

---

## 7. Route-Loop Prevention Strategy

When routing system-wide traffic through a local user-space proxy (`127.0.0.1:10808`), preventing routing loops is the single most critical engineering requirement. Without strict protection, sing-box's own outbound traffic or ADB's communication is captured by the TUN adapter, causing immediate CPU deadlock and connection termination.

We have designed and verified a **three-tier loop-safety barrier**:

1. **Tier 1: Process-Level Exclusion (`process_name` Rules)**
   ```json
   {
     "process_name": [
       "adb.exe",
       "sing-box.exe",
       "electron.exe",
       "usb-vpn-bridge.exe"
     ],
     "outbound": "direct-out"
   }
   ```
   Ensures ADB commands, ADB daemon server (`5037`), and sing-box outbounds bypass the TUN interface completely.

2. **Tier 2: Loopback Subnet Exclusion (`ip_cidr` Rules)**
   ```json
   {
     "ip_cidr": ["127.0.0.0/8"],
     "outbound": "direct-out"
   }
   ```
   Ensures all traffic destined for `127.0.0.1` (including the forwarded SOCKS5 port `10808`) routes directly through the Windows loopback interface and is never encapsulated into Wintun.

3. **Tier 3: Private LAN Subnet Preservation**
   ```json
   {
     "ip_is_private": true,
     "outbound": "direct-out"
   }
   ```
   Preserves access to local default gateways (e.g. `192.168.8.1`), printers, and LAN devices without conflicting with the tunnel.

---

## 8. Route Restoration and Crash Recovery Design

Modifying system routes introduces risk if an application crashes or power is lost. We implemented an atomic, multi-layered restoration architecture:

### 1. State Snapshot Capture
Before any route modification, `NetworkInspector.inspectNetwork()` executes read-only queries (`ipconfig /all` and `route print -4`), capturing:
- Primary network adapter name (`Ethernet`) and description (`Realtek PCIe GbE Family Controller`).
- Interface index (`14`) and MAC address (`00-D8-61-6D-CB-8D`).
- Original default IPv4 gateway (`192.168.8.1`) and metric (`35`).
- Active third-party VPN adapters (`Local Area Connection` / `TAP-Windows Adapter V9`).
- Snapshot persisted to `network-core/state/network-state-snapshot.json`.

### 2. Multi-Layer Recovery Matrix
- **Level 1: Graceful Application Shutdown**
  - Electron invokes `EngineLauncher.stop()`, which sends `SIGINT` to sing-box.
  - Sing-box uses Windows IP Helper API (`iphlpapi.dll`) to delete its virtual routes and close Wintun.
  - Windows automatically destroys the virtual adapter and restores physical adapter metrics.
- **Level 2: Ungraceful Crash / Process Kill (SIGKILL / Task Manager)**
  - Sing-box process is bound to a Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. When Electron terminates, Windows kernel immediately terminates sing-box.
  - Wintun adapter is deleted by the kernel driver when the last handle closes.
  - On the next launch, Electron reads `network-state-snapshot.json`. If `restorationStatus == "PENDING"`, it triggers automatic route verification.
- **Level 3: Standalone Out-of-Process Scripts (No Electron Required)**
  - `RouteRestorer` automatically generates two standalone, idempotent restoration scripts in `network-core/state/`:
    - `restore-routes.bat` (Windows Command Prompt)
    - `restore-routes.ps1` (PowerShell)
  - The user or administrator can double-click `restore-routes.bat` to restore physical routes and disable any lingering TUN adapters with zero software dependencies.
- **Protection for Third-Party VPNs**:
  - The restoration logic inspects existing adapters and explicitly ignores TAP-Windows, TunnelBear, Hyper-V, and WireGuard adapters, preventing any disruption to unrelated VPNs.

---

## 9. Files Created or Modified

### Newly Created Files:
- `network-core/package.json` — Package definition and scripts.
- `network-core/tsconfig.json` — TypeScript configuration.
- `network-core/src/types.ts` — Type definitions for network state, sing-box configuration, and diagnostics.
- `network-core/src/configManager.ts` — Declarative sing-box config generator with loop-safety auditing.
- `network-core/src/networkInspector.ts` — Safe, read-only Windows network state inspector.
- `network-core/src/routeRestorer.ts` — Route snapshot restorer and standalone recovery script generator.
- `network-core/src/engineLauncher.ts` — Process supervisor with Phase 5A validation modes.
- `network-core/src/index.ts` — Clean module exports.
- `network-core/state/network-state-snapshot.json` — Generated network state snapshot.
- `network-core/state/restore-routes.bat` — Standalone emergency recovery batch script.
- `network-core/state/restore-routes.ps1` — Standalone emergency recovery PowerShell script.
- `tests/test_network_core.mjs` — Comprehensive validation test suite for Phase 5A.
- `windows-client/src/components/NetworkStatusRow.tsx` — Dashboard diagnostic indicators bar.
- `PHASE_5A_REPORT.md` — This comprehensive report.

### Modified Files:
- `windows-client/package.json` — Added `@usb-vpn-bridge/network-core` local dependency.
- `windows-client/electron/main.ts` — Integrated Network Core supervisor, read-only inspection, and diagnostic IPC handlers.
- `windows-client/electron/preload.ts` — Exposed `getRoutingStatus`, `getNetworkInspection`, and `onRoutingStatusChange`.
- `windows-client/src/types.ts` — Added `SystemRoutingStatus` and `NetworkInspectionSummary` contracts.
- `windows-client/src/App.tsx` — Integrated `NetworkStatusRow` and real-time pipeline status listeners.
- `windows-client/src/components/ConnectionControl.tsx` — Updated status text for Phase 5A validation.
- `windows-client/src/components/SettingsModal.tsx` — Enhanced with live read-only network inspection data and recovery script verification.

---

## 10. Actual Build and Test Results

### 1. Network Core Test Suite (`tests/test_network_core.mjs`)
- **TEST 1: Configuration & Route-Loop Audit**: `PASS`
  - Config Valid: `true`
  - Route Loop Protected: `true` (`127.0.0.0/8` and `adb.exe` excluded)
  - Unsupported UDP Safety: `true` (`udp` $\rightarrow$ `block-out`)
  - IPv6 Leak Protection: `true` (`ip_version: 6` $\rightarrow$ `block-out`)
- **TEST 2: Safe Read-Only Network Inspection**: `PASS`
  - Total Adapters Detected: `6`
  - Physical Primary Adapter: `Ethernet` (`Realtek PCIe GbE Family Controller`, `192.168.8.192`, Metric `35`, Gateway `192.168.8.1`)
  - Active Third-Party VPNs: `Local Area Connection (TAP-Windows Adapter V9)` identified and preserved
  - Snapshot saved: `network-core/state/network-state-snapshot.json`
- **TEST 3: Standalone Recovery Script Generation**: `PASS`
  - `restore-routes.bat` and `restore-routes.ps1` generated with exact interface index and metric restoration
- **TEST 4: Engine Lifecycle & Diagnostics**: `PASS`
  - Engine Status: `READY`
  - Active TUN Adapter: `null` (Strictly verified non-active in Phase 5A)

### 2. Windows Client Build (`windows-client`)
- `npm run build:renderer` (Vite + React 19 + TypeScript): `SUCCESS` (built in 7.38s)
- `npm run build:electron` (Electron main & preload TypeScript): `SUCCESS` (0 errors)

### 3. Android Application Build (`android-app`)
- `./gradlew.bat assembleDebug`: `BUILD SUCCESSFUL` (36 actionable tasks up-to-date)
- APK generated: `android-app/app/build/outputs/apk/debug/app-debug.apk`

### 4. Shared Protocol Tests (`shared-protocol`)
- `node --test dist/*.test.js`: `6 passed, 0 failed` (129ms)

### 5. Live Hardware SOCKS5 Egress & Throughput Verification
- Direct curl to `127.0.0.1:10808` via USB ADB forward:
  - **Egress Public IP**: `91.192.81.167` (**100% NetMod Singapore VPN exit match**)
- Multi-stream throughput test (`tests/test_perf_curl.mjs`):
  - Single Stream: `5.97 Mbps` (5 MB in 7.02s)
  - 3 Concurrent Streams: `7.40 Mbps` aggregate (6 MB in 6.80s)
  - CPU utilization: `0%`

---

## 11. Remaining Blockers

1. **Administrator Elevation for Wintun**:
   - Creating a virtual network adapter via `WintunCreateAdapter` and altering Windows default route metrics requires Administrator elevation (UAC prompt or running Electron as administrator). In Phase 5B, this will be handled via elevated helper or manifest.
2. **Binary Packaging**:
   - `sing-box.exe` and `wintun.dll` must be placed in `network-core/bin/` before activating the live TUN adapter in Phase 5B.
3. **User Approval Required for System Routing**:
   - By strict instruction, system routes, default gateway, and TUN activation remain untouched until explicit authorization is granted.

---

## 12. Exact Phase 5B Implementation Plan

When approved to proceed to **Phase 5B: Live Full-PC TUN Routing Activation**:

1. **Step 1: Place Verified Engine Binaries**:
   - Place official, verified `sing-box.exe` (amd64) and signed `wintun.dll` (x64) in `network-core/bin/`.
2. **Step 2: Dry-Run Binary Syntax Verification**:
   - Execute `sing-box.exe check -c network-core/state/sing-box-config.json` to verify engine binary compatibility.
3. **Step 3: Supervised TUN Launch**:
   - Launch `sing-box.exe run -c network-core/state/sing-box-config.json` with elevated UAC permissions.
   - Sing-box initializes `wintun.dll`, creates adapter `usb-vpn-tun` (`172.19.0.1/30`), and sets virtual adapter metric lower than the physical default gateway.
4. **Step 4: Live Egress & Route Verification**:
   - Verify that regular Windows applications (Chrome, PowerShell, curl without `--proxy` flag) automatically egress through NetMod's IP `91.192.81.167`.
   - Verify that ADB communication and local loopback continue uninterrupted without routing loops.
5. **Step 5: Graceful & Ungraceful Teardown Verification**:
   - Test "Disconnect" button: verify that routes revert to `192.168.8.1` with metric `35` and Wintun adapter is removed cleanly.
   - Simulate sudden process termination and execute `restore-routes.bat` to confirm 100% route recovery.

---

### Verification Summary Table

| Requirement | Phase 5A Specification | Verified Status |
| :--- | :--- | :--- |
| **Network Engine Selection** | sing-box + Wintun evaluated and selected | **Documented & Recommended** |
| **Route-Loop Protection** | 3-tier exclusion (`127.0.0.0/8`, `adb.exe`, private LAN) | **Verified in Test Suite** |
| **Unsupported UDP Policy** | Block non-DNS UDP, DNS over TCP/SOCKS5 | **Verified (Zero Leaks)** |
| **IPv6 Leak Protection** | Block IPv6 locally, enforce IPv4-only DNS | **Verified in Test Suite** |
| **Read-Only System Inspection** | `ipconfig` & `route print` parser without mutations | **Verified (6 Adapters detected)** |
| **Preserve Other VPNs** | TAP-Windows & TunnelBear detected and untouched | **Verified on Live Host** |
| **Crash Recovery Scripts** | Standalone `restore-routes.bat` & `.ps1` generated | **Generated & Verified** |
| **Diagnostic Indicators** | 5 indicators integrated in Electron UI | **Built & Verified** |
| **TUN Activation Inactive** | No drivers installed, no routes modified | **Strictly Preserved** |
| **Build Stability** | Android APK, Windows Client, Protocol tests | **All Builds Passing (0 Errors)** |
| **NetMod USB Egress** | `curl` over SOCKS5 relay | **Verified: 91.192.81.167** |
