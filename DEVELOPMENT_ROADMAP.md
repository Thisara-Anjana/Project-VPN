# Development Roadmap: USB VPN Bridge

This roadmap defines the iterative development stages for the USB VPN Bridge. Development strictly follows sequential execution: **each phase must be completed, validated, and approved before proceeding to the next**.

---

## Roadmap Overview

```
Phase 1: Research, Environment Inspection & Architecture [CURRENT - COMPLETED]
   │
Phase 2: Application Foundations (Android Skeleton, Windows Skeleton, Protocol)
   │
Phase 3: USB Communication & ADB Control Handshake
   │
Phase 4: Basic USB Internet Sharing (Android Relay & Windows Proxy)
   │
Phase 5: Windows-Wide Networking (Wintun + sing-box TUN Integration)
   │
Phase 6: NetMod VPN Integration & Egress Verification
   │
Phase 7: User Interface & Experience
   │
Phase 8: Performance, Stress Testing & Reliability Hardening
   │
Phase 9: Packaging & Deployment (APK & Windows Installer)
```

---

## Detailed Milestone Descriptions

### Phase 1 — Research and Environment Inspection [COMPLETED]
- [x] Study Tetrd's publicly documented functionality and architecture.
- [x] Check Windows version (Windows 11 AMD64 build 26300).
- [x] Verify toolchain: Node.js (v24), npm (11.19), Git (2.52), Java (JDK 21 Temurin), ADB (v1.0.41).
- [x] Check connected Android device: Nothing Phone (2a) / Android 16 / authorized.
- [x] Confirm NetMod VPN installation on device (`com.netmod.syna`).
- [x] Research Windows TUN requirements (`wintun.dll`, sing-box TUN, routing tables).
- [x] Investigate non-root Android forwarding mechanisms.
- [x] Create project documentation (`README.md`, `ARCHITECTURE.md`, `FEASIBILITY_REPORT.md`, `DEVELOPMENT_ROADMAP.md`, `.gitignore`).
- [x] Initialize Git repository.

---

### Phase 2 — Application Foundations [NEXT UP]
**Objective**: Build verifiable skeletons for both applications and establish the shared communication protocol without activating system networking changes.
- **Task 2.1**: Initialize the Android project skeleton in `android-app/`:
  - Kotlin, Android Gradle Plugin, compileSdk 35/36, minSdk 26.
  - Setup Gradle wrapper (`gradlew`).
  - Create the main Activity and the skeleton `ForegroundService` with notification channel.
  - Define permissions (`INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `POST_NOTIFICATIONS`).
- **Task 2.2**: Initialize the Windows client skeleton in `windows-client/`:
  - Electron + React + TypeScript + Vite.
  - Setup core main process and IPC scaffolding.
  - Implement basic UI frame (Connection toggle, Status indicator, Device selector).
- **Task 2.3**: Define the shared protocol specifications in `shared-protocol/`:
  - TypeScript & Kotlin data definitions for handshake, heartbeats, status messages, and metrics.
- **Task 2.4**: Build verification:
  - Verify that the Windows client starts and renders cleanly.
  - Verify that the Android application builds into a debug APK.

---

### Phase 3 — USB Communication & Control Channel
**Objective**: Establish robust bidirectional USB communication between Windows and Android using ADB.
- Integrate ADB manager in Windows supervisor to detect device attachment/detachment.
- Implement automated `adb forward` for control and data ports.
- Establish TCP socket handshake on control port (10809).
- Implement continuous ping/pong heartbeat and disconnection detection.
- Test physical cable disconnect and reconnect scenarios.

---

### Phase 4 — Basic USB Internet Sharing
**Objective**: Implement user-space relay and verify internet traffic flow from Windows through Android.
- Implement Android SOCKS5/HTTP socket relay in `android-app` using Kotlin Coroutines/NIO.
- Forward traffic from Windows localhost proxy port over USB to Android relay.
- Validate real HTTP/HTTPS traffic from Windows browser/curl through Android connection.
- Measure preliminary throughput and latency over USB.

---

### Phase 5 — Windows-Wide Networking (System TUN)
**Objective**: Capture 100% of Windows application traffic and route it through the USB bridge.
- Integrate `wintun.dll` and `sing-box` TUN engine into `network-core/`.
- Configure automated default gateway routing and DNS interception.
- Implement strict leak prevention (`strict_route`).
- Implement the network state sentinel to snapshot and cleanly restore Windows default routes and DNS upon disconnect or crash.
- Test TCP and UDP applications (browsers, Discord, DNS queries).

---

### Phase 6 — NetMod VPN Integration
**Objective**: Guarantee that all tethered Windows traffic egresses through NetMod's active VPN tunnel.
- Connect NetMod VPN on the Android device.
- Test whether Android relay sockets route through NetMod's `tun0` interface.
- Perform public IP egress tests on Windows (e.g. `curl https://api.ipify.org`) and compare with phone's NetMod egress IP.
- Test NetMod's internal proxy tethering mode if needed.
- Verify NetMod stability and confirm zero VpnService disconnects.

---

### Phase 7 — User Interface & Experience
**Objective**: Create a polished, responsive user interface for both platforms.
- Windows UI: Modern glass/dark theme, one-click Connect/Disconnect button, live speed graphs (upload/download), latency meter, session data counter, device authorization guides.
- Android UI: Simple modern Material 3 interface, service status switch, USB connection indicator, NetMod status badge, active transfer statistics.
- Diagnostic logs and troubleshooting drawer.

---

### Phase 8 — Performance, Stress Testing & Reliability Hardening
**Objective**: Maximize throughput, minimize latency, and ensure rock-solid stability under sustained load.
- Benchmark sustained multi-gigabyte downloads.
- Stress test with hundreds of concurrent connections (torrent/web crawl simulation).
- Measure CPU and memory footprint on both Windows and Android.
- Test edge cases: USB cable yank, phone screen lock, device sleep, Android Doze mode.
- Fine-tune TCP buffer sizes and backpressure handling.

---

### Phase 9 — Packaging & Deployment
**Objective**: Deliver production-ready installers and setup documentation.
- Package Android application as signed release `.apk`.
- Package Windows application as an automated installer (`.exe` via electron-builder / NSIS).
- Bundle `wintun.dll`, `sing-box.exe`, and portable `adb.exe` into Windows distribution.
- Write end-user setup documentation and verification checklist.
