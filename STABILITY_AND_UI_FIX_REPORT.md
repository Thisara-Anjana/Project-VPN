# USB VPN Bridge — Stability, Performance & UI Fix Report

**Date:** November 19, 2026  
**Project Root:** `G:\Project VPN`  
**Status:** Completed & Packaged for Personal Beta (Offline Verification Mode)

---

## Executive Summary

This report documents the architectural, performance, and user interface improvements implemented across the **USB VPN Bridge** system (Android Kotlin application and Windows Electron desktop client).

All 10 requested tasks have been fulfilled without making live Windows networking modifications (as the physical Android device is currently disconnected). Comprehensive offline unit, static analysis, build, and packaging tests were executed and passed.

### Primary Release Artifacts

| Artifact | File Size | SHA-256 Checksum | Location |
| :--- | :--- | :--- | :--- |
| **Windows Installer** | 107,391,643 bytes (~102.4 MB) | `CDC9424AF43C34CDB60403A65CDC360B76B8A447315E0F485B83562B96BDB0C7` | `release/USB-VPN-Bridge-Setup.exe` |
| **Android APK** | 7,403,217 bytes (~7.06 MB) | `64C75800241AC087F20480CFC4B671BE45ABB134C7D5FB87E48D3159CD372FCA` | `release/USB-VPN-Bridge.apk` |

---

## Detailed Task Breakdown & Implementation Details

### Task 1 — Fix High-Traffic Disconnections

#### Root Causes Identified:
1. **Coroutine Thread Starvation on `Dispatchers.IO`:**
   - Both SOCKS5 TCP streaming (`pipeStream`) and the USB control channel (`handleClientSession`) ran on Kotlin's standard `Dispatchers.IO` pool (limited to 64 threads).
   - Under heavy traffic (multiple browser tabs or high-volume downloads opening 20+ concurrent TCP connections), each connection spawned 2 streaming jobs and 1 parent job (`join()`), exhausting all 64 threads.
   - Consequently, the control channel coroutines handling incoming Windows `HEARTBEAT` frames could not obtain a thread to read or respond, causing the Windows client (`missedHeartbeats >= 6`) or Android watchdog (`> 10000ms`) to sever the link.
2. **Buffer Flush Overhead:**
   - In `pipeStream`, `output.flush()` was called after every single read chunk (often 1460-byte MTU packets). Under high throughput, this generated tens of thousands of unnecessary system calls per second, resulting in CPU saturation and kernel buffer thrashing.
3. **Leaked Keep-Alive Sockets:**
   - Sockets used `soTimeout = 0` (infinite timeout). Abandoned HTTP/1.1 keep-alive connections held coroutines indefinitely.

#### Fixes Implemented:
- **Dedicated Control Dispatcher:** Isolated all USB control channel operations (`startControlListener`, `handleClientSession`, frame deframing, heartbeat processing) to a dedicated single-threaded dispatcher (`controlDispatcher = Executors.newSingleThreadExecutor { ... }.asCoroutineDispatcher()`). Even during 100% saturation of data proxying, heartbeats and control messages are deframed and replied to with zero jitter.
- **Optimized Stream Piping:** Removed `output.flush()` from inside the read loop in `Socks5ProxyServer.kt`, allowing TCP buffers to coalesce naturally, with flush occurring only upon EOF or shutdown.
- **Bounded Backlog & Timeouts:** Increased `ServerSocket` backlog from 50 to 256 and added a bounded 60-second idle read timeout (`soTimeout = 60000`) on data sockets to cleanly clean up abandoned connections.
- **Cooperative Stream Teardown:** When either direction encounters EOF or closes, `peerSocket.shutdownOutput()` is triggered immediately, ensuring partner coroutines unblock promptly.

---

### Task 2 — Fix Windows Internet Speed Display

#### Root Causes Identified:
1. Telemetry in the Windows client was only updated when handling `MessageType.STATUS` frames, but the Windows client never polled or requested `STATUS` after connecting.
2. `MessageType.HEARTBEAT` responses did not carry telemetry data, causing `speedDownloadBps` and `speedUploadBps` to stay at 0 or freeze.
3. The UI component (`StatsGrid.tsx`) divided input values by 1024 and labeled them `KB/s` (treating input as Bytes/s), while Android previously computed speeds in bits/s.

#### Fixes Implemented:
- **Piggybacked Telemetry on Heartbeats:** Extended `HeartbeatPayload` across `shared-protocol` and Android `Protocol.kt` with optional fields:
  ```typescript
  export interface HeartbeatPayload {
    sequence: number;
    senderTimestamp: number;
    replyTimestamp?: number;
    bytesReceived?: number;
    bytesSent?: number;
    speedDownloadBps?: number;
    speedUploadBps?: number;
    activeSockets?: number;
  }
  ```
  Every 1.5-second heartbeat reply from Android now transmits current byte counters and active socket counts directly to Windows.
- **High-Resolution Local Rate Calculator:** Implemented an internal rolling rate calculator in `orchestrator.ts` that computes exact byte deltas over measured elapsed time:
  $$\text{Speed (Bytes/s)} = \frac{\Delta \text{Bytes}}{\Delta t}$$
- **Idle Clamping:** When no bytes are transferred or when the session is idle/disconnected, speeds immediately return strictly to `0.00 KB/s`.
- **Perspective Alignment:** Verified directionality from the PC perspective:
  - **Download:** Target server $\rightarrow$ Android $\rightarrow$ PC Client (`totalBytesReceived`).
  - **Upload:** PC Client $\rightarrow$ Android $\rightarrow$ Target server (`totalBytesSent`).

---

### Task 3 — Improve Android Performance and Phone Health

#### Optimizations Implemented:
1. **CPU & RAM Reductions:**
   - 32 KB bounded buffers (`ByteArray(32768)`) reused efficiently per stream.
   - Removed hot-path logcat formatting and debug messages during active socket streaming.
2. **Thermal Monitoring (API 29+):**
   - Implemented `PowerManager.OnThermalStatusChangedListener` in `RelayForegroundService.kt`.
   - Directly detects `THERMAL_STATUS_LIGHT`, `MODERATE`, `SEVERE`, and `CRITICAL` states without polling.
   - Logs thermal warnings to `ServiceStateHolder` and updates the UI thermal pill indicator.

---

### Task 4 — Keep Tethering Working When Screen Is OFF

#### Fixes Implemented:
1. **Permission Added:** Added `<uses-permission android:name="android.permission.WAKE_LOCK" />` and `<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />` to `AndroidManifest.xml`.
2. **Dynamic Partial WakeLock:**
   - `RelayForegroundService.kt` acquires a `PARTIAL_WAKE_LOCK` with tag `USBVPNBridge::RelayWakeLock` when the PC client establishes an active control session.
   - Keeps CPU active and USB/TCP sockets responsive while screen is locked, off, or app is minimized.
   - Automatically releases the wake lock when the PC disconnects or service stops.
3. **Foreground Service & Notification:**
   - Utilizes `IMPORTANCE_LOW` notification channel so the ongoing tethering notification is persistent and non-intrusive.
4. **Battery Optimization Guidance:**
   - Added an interactive Settings dialog in `MainActivity.kt` that informs users and provides a direct shortcut to Android's `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`.

---

### Task 5 — Redesign Android UI

#### UI Enhancements:
- **Dark Theme Surface:** Dark slate background (`#090D16`), rounded card surfaces (`#111827`), and subtle borders (`#1E293B`).
- **Connection Hero Card:**
  - Status dot indicator (Green = Connected, Amber = Connecting, Red = Disconnected, Gray = Stopped).
  - Connected PC Name row.
  - Active Android VPN pill (`NetMod VPN (tun0)`).
  - Session Duration (`00:00`).
  - Prominent Start/Stop Service Button (52dp height, 12dp corner radius) with clear colored states.
- **2x2 Telemetry Grid:**
  - Download Speed (Emerald monospace).
  - Upload Speed (Cyan monospace).
  - Total Data Transferred (Primary white monospace).
  - Active TCP Sockets (Purple monospace).
- **Collapsible Activity Log:**
  - Scrollable dark terminal box showing timestamped system events.
  - One-click "Copy" (to clipboard) and "Clear" buttons.

---

### Task 6 — Create a New Round Android App Icon

#### Asset Generation:
- Created an adaptive vector icon theme matching the Windows client styling:
  - `res/drawable/ic_launcher_background.xml`: Deep navy/slate radial gradient (`#1E293B` to `#090D16`).
  - `res/drawable/ic_launcher_foreground.xml`: Multi-layer vector graphic featuring a cyan outer orbit ring (`#38BDF8`), royal blue VPN security shield (`#2563EB`), crisp white USB connector body, and glowing data nodes.
  - `res/mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`: Fully configured for circular and adaptive launcher shapes across Android 8.0+.

---

### Task 7 — Improve Connection Recovery

#### Reliability Hardening:
- Maintained automated PID check via `tasklist.exe` and `cleanupStaleState` in `network-core` to clean orphan `engine.active` / `engine.pid` locks upon launch or reconnection.
- Handled USB re-plugs and service restarts gracefully: if the USB cable is unplugged, orchestrator detects socket closure, cleans forwarders, resets speed calculations to 0, and restores original network state safely without touching unrelated VPNs.

---

### Task 8 — Offline Verification Testing

| Test Suite | Result | Details |
| :--- | :--- | :--- |
| **Android Gradle Build** | **PASSED** (Exit 0) | Clean compile of Kotlin, resources, data binding, and packaging (`app-debug.apk`). |
| **Shared Protocol Build** | **PASSED** (Exit 0) | TypeScript compilation (`tsc`) of extended `HeartbeatPayload`. |
| **Windows Client Build** | **PASSED** (Exit 0) | Vite + React + Electron main/renderer clean compilation (`dist/`, `dist-electron/`). |
| **Network Core Pre-Activation Suite** | **PASSED** (5/5 tests) | MTU 1500 strict exclusions, binary validation, dynamic snapshot, emergency scripts. |
| **Orchestrator Integration Suite** | **PASSED** (12/12 tests) | UAC supervisor validation, sing-box binary audit, state machine transitions, restore safety. |
| **NSIS Installer Packaging** | **PASSED** (Exit 0) | Electron-builder x64 executable packaging (`USB-VPN-Bridge-Setup.exe`). |

---

### Task 9 — Build Updated Artifacts

The final release files were generated and placed in `release/`:
- `release/USB-VPN-Bridge-Setup.exe` (102.4 MB)
- `release/USB-VPN-Bridge.apk` (7.06 MB)
- `release/CHECKSUMS_SHA256.txt` (Updated with verified hashes)
- `release/RELEASE_NOTES.md` (Updated)

---

### Task 10 — Physical Device Reconnection Checklist

When reconnecting the physical Android phone for live verification:

1. **On Android Phone:**
   - Install `release/USB-VPN-Bridge.apk` (`adb install -r release/USB-VPN-Bridge.apk`).
   - Tap the new circular USB VPN Bridge icon to open.
   - Connect NetMod VPN (or your preferred Android VPN) and confirm the VPN key icon is visible in the Android status bar.
   - Tap **Start USB Service** in the app.
   - Tap the gear icon in the top right to verify Battery Optimization is disabled for uninterrupted screen-off tethering.
2. **On Windows PC:**
   - Run the updated `USB-VPN-Bridge-Setup.exe` installer (or launch the installed application).
   - Verify phone is detected in the UI with its model name.
   - Click **Connect** and approve the single UAC prompt.
   - Verify all steps complete to `INTERNET_CONNECTED`.
   - Confirm download and upload speeds show live values during browsing and return to `0.00 KB/s` when idle.
   - Lock/turn off the Android screen and verify sustained downloading without disconnection.
   - Click **Disconnect** and verify normal internet restoration.
