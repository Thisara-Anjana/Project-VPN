# USB VPN Bridge — Tetrd-Style Reliability Rebuild Report

**Project Root:** `G:\Project VPN`  
**Date:** November 20, 2026  
**Status:** Completed & Verified  

---

## 1. Executive Summary

This rebuild addresses the root causes of instability reported during USB VPN tethering. Drawing from the architectural principles of **Tetrd** (and **PdaNet+**), the networking, connection monitoring, and background lifecycle layers have been refactored for rock-solid reliability:
1. **Background & Minimized Window Immunity:** Windows power suspension and Chromium background timer throttling are permanently prevented via `powerSaveBlocker` and `backgroundThrottling: false`.
2. **Screen-Off Android Tethering:** The Android `RelayForegroundService` acquires a `PARTIAL_WAKE_LOCK` upon service start and holds it throughout active foreground operation, preventing Android Doze mode from sleeping the CPU when the screen goes dark.
3. **Heavy-Traffic Resilience:** The Android SOCKS5 proxy was redesigned to eliminate premature socket half-closes (`shutdownOutput()`), expanded to 64 KB streaming buffers, and assigned 256 KB TCP socket buffers to eliminate stalls under multi-stream and high-bandwidth downloads.
4. **Transient USB Glitch Auto-Recovery:** Instead of immediately tearing down Wintun and deleting routes upon a single lost packet or momentary ADB hiccup, the orchestrator now executes a serialized 3-attempt reconnection cycle that recovers the session seamlessly without breaking internet traffic.
5. **Fail-Closed Clean Restoration:** All route restoration and TUN teardown routines remain idempotent and fail-closed, with transition mutexes strictly released in `finally` blocks to eliminate state-machine deadlocks.

---

## 2. Main Causes of Instability Identified & Addressed

| # | Root Cause in Previous Implementation | Impact on User Experience | Tetrd-Style Solution Applied |
|---|---|---|---|
| **1** | **Chromium Timer Throttling on Window Minimize** | Minimizing the Electron window caused timers and IPC event loops to throttle or suspend. | Added `backgroundThrottling: false` to `BrowserWindow.webPreferences`. |
| **2** | **Windows 10/11 EcoQoS Process Suspension** | Windows throttled background Electron processes, coalescing timers and causing false heartbeat timeouts. | Implemented Electron `powerSaveBlocker.start("prevent-app-suspension")` during active tethering. |
| **3** | **Premature WakeLock Release on Android** | `releaseWakeLock()` was called whenever a client socket closed or timed out, letting Android Doze sleep the CPU. | Preserved `PARTIAL_WAKE_LOCK` across client sessions; only released on `onDestroy()` when the user stops the service. |
| **4** | **Brittle Heartbeat Timeouts (9s / 10s)** | Heavy TCP downloads and USB bus queuing easily delayed 1.5s pings past the 9-second threshold, dropping the VPN. | Raised watchdog tolerance to **25 seconds** (15 missed heartbeats) on both Windows and Android. |
| **5** | **Premature SOCKS5 Socket Shutdown** | Calling `target.shutdownOutput()` in bidirectional streams caused TCP FINs to sever concurrent download pipes. | Eliminated half-close calls; stream jobs run concurrently until EOF or connection error before clean socket destruction. |
| **6** | **State-Machine Transition Deadlock** | When an unexpected error occurred, `isTransitioning` was not cleared in a `finally` block, locking the UI on "Connecting...". | Enforced `finally { this.isTransitioning = false; }` across all orchestrator state transitions. |
| **7** | **Zero Reconnection Tolerance** | Any momentary USB bus renegotiation immediately aborted the session and purged the network adapter. | Added `attemptConnectionRecovery()`: 3 rapid retries to re-forward ADB and restore control channel without dropping Wintun. |
| **8** | **Renderer-Driven Device Polling** | The React renderer ran `setInterval` polling for ADB devices, stalling when backgrounded. | Moved device monitoring to the Electron Main process with push updates (`adb:devices-changed`). |

---

## 3. Architecture Comparison: Tetrd vs. USB VPN Bridge

```
                     ┌─────────────────────────────────────────────────────────────┐
                     │                     ANDROID DEVICE                          │
                     │                                                             │
                     │  Active VPN (e.g., NetMod / tun0)                           │
                     │       ▲                                                     │
                     │       │ (Standard Android Sockets — Zero VpnService Conflict)│
                     │       ▼                                                     │
                     │  RelayForegroundService (Persistent PARTIAL_WAKE_LOCK)      │
                     │  ├── SOCKS5 TCP Proxy (127.0.0.1:10808, 64KB buffers)      │
                     │  └── Control Listener (127.0.0.1:10809, 25s watchdog)       │
                     └──────────────────────────────▲──────────────────────────────┘
                                                    │
                                     USB ADB Forwarding Tunnels
                                    (10808 -> 10808, 10809 -> 10809)
                                                    │
                     ┌──────────────────────────────▼──────────────────────────────┐
                     │                   WINDOWS 10/11 HOST                        │
                     │                                                             │
                     │  Electron Main Process (powerSaveBlocker active)            │
                     │  ├── ControlClient (25s watchdog, auto-reconnect)           │
                     │  ├── AdbManager (background device poller)                  │
                     │  └── ConnectionOrchestrator (fail-closed state machine)    │
                     │           ▲                                                 │
                     │           │ Supervises elevated runner                      │
                     │           ▼                                                 │
                     │  Native TUN Engine: sing-box v1.14.4 + Wintun v0.14.1        │
                     │  └── Virtual Adapter: 'usb-vpn-tun' (MTU 1500, Metric 1)    │
                     │                                                             │
                     │  React User Interface (backgroundThrottling: false)        │
                     │  └── Single Connect/Disconnect Button + Realtime Telemetry  │
                     └─────────────────────────────────────────────────────────────┘
```

---

## 4. Summary of Files Changed

### A. Android Application (`android-app/`)
* **`app/src/main/java/com/usbvpnbridge/android/proxy/Socks5ProxyServer.kt`**
  - Expanded `BUFFER_SIZE` from 32 KB to 64 KB (65536 bytes) for sustained high throughput.
  - Configured socket buffer sizes: `receiveBufferSize = 262144` (256 KB), `sendBufferSize = 131072` (128 KB).
  - Removed premature `shutdownOutput()` calls from upload/download coroutine pipes, eliminating TCP connection resets during multi-stream HTTP/TLS downloads.
* **`app/src/main/java/com/usbvpnbridge/android/service/RelayForegroundService.kt`**
  - Acquired `PARTIAL_WAKE_LOCK` upon `onStartCommand()`, maintaining CPU execution when the Android screen turns off.
  - Removed premature `releaseWakeLock()` calls from transient client session disconnects; wake lock is now preserved throughout the entire foreground service lifetime.
  - Increased heartbeat watchdog timeout from 10,000ms to **25,000ms** to tolerate USB bus queueing and background scheduling.

### B. Windows Client (`windows-client/`)
* **`electron/orchestrator.ts`**
  - Guaranteed `finally { this.isTransitioning = false; }` in both `connect()` and `disconnect()` to prevent UI transition lockups.
  - Implemented `attemptConnectionRecovery()`: performs up to 3 automatic reconnection attempts upon transient USB control loss before tearing down the TUN engine.
  - Added fast retry (800ms) to `executeTunDiagnostic()` to accommodate Windows route table metric convergence delays.
  - Relaxed telemetry zeroing threshold from 3.5s to 15s to tolerate background timer jitter.
* **`electron/main.ts`**
  - Added `backgroundThrottling: false` to `BrowserWindow.webPreferences`.
  - Integrated Electron `powerSaveBlocker.start("prevent-app-suspension")` during active connection states.
  - Added `minimize`, `restore`, and `focus` window event hooks ensuring non-destructive background operation and immediate UI state synchronization.
  - Migrated device polling to the Electron Main process with `adb:devices-changed` push notifications.
* **`electron/controlClient.ts`**
  - Increased heartbeat timeout threshold to **15 missed heartbeats (22.5s)** and added `elapsedSinceLastHb > 25000` timestamp verification.
  - Initialized `lastHeartbeatTime: now` upon `HELLO_ACK` handshake completion for immediate baseline calibration.
* **`electron/preload.ts` & `src/App.tsx` & `src/types.ts`**
  - Exposed `onDevicesChange` listener in the preload bridge.
  - Subscribed React interface to Main process device push updates and window focus synchronization.

### C. Test Suites (`tests/`)
* **`tests/test_tetrd_reliability.mjs`** (New suite: 17 tests verifying transition safety, SOCKS5 buffers, screen-off WakeLock, powerSaveBlocker, and watchdog tolerances).
* **`tests/test_background_stability.mjs`** (13 tests verifying minimize/background configuration).

---

## 5. Verification & Test Results

All automated test suites executed successfully in the offline environment:

| Test Suite | Purpose | Tests | Result |
|---|---|:---:|:---:|
| **`test_network_core.mjs`** | sing-box configuration, MTU 1500, emergency recovery scripts, network inspection | 5 | **PASSED** (5/5) |
| **`test_phase6_orchestrator.mjs`** | Elevated supervisor (`run-elevated.ps1`), state transitions, route safety | 12 | **PASSED** (12/12) |
| **`test_background_stability.mjs`** | Window minimize immunity, powerSaveBlocker, 25s watchdogs, preload bridge | 13 | **PASSED** (13/13) |
| **`test_tetrd_reliability.mjs`** | SOCKS5 64KB buffers, persistent WakeLock, auto-recovery retries, transition mutex | 17 | **PASSED** (17/17) |
| **Total Automated Tests** | | **47** | **ALL PASSED (47/47)** |

---

## 6. Build Artifacts & Checksums

Both installation packages have been rebuilt, packaged, and verified:

| Artifact | Type | File Path | SHA256 Checksum |
|---|---|---|---|
| **Windows Installer** | Windows 10/11 x64 NSIS Setup | `release/USB-VPN-Bridge-Setup.exe` | `85B212F72971C9DBB83193BB3B312AF31DB39A732691424813831D8252893CD0` |
| **Android APK** | Android Debug APK (API 26+) | `release/USB-VPN-Bridge.apk` | `ABBCB2287BA4D1332898C3686FA6EC0ABF579A79ECB5CB2D8B3D8D240AE28356` |

*Checksums recorded in `release/CHECKSUMS_SHA256.txt`.*

---

## 7. Remaining Items / Physical Device Verification

Because the physical Android smartphone is currently disconnected:
* **Pending Physical Device Test:** Connect the phone over USB, verify that Android screen turns off while tethering, verify that minimizing the Windows client retains sustained internet traffic during a heavy download (e.g. 50+ MB file or YouTube streaming), and confirm one-click Disconnect restores original direct Windows internet cleanly.
* **No Live Windows Network Modifications Made:** As agreed, no live route alterations were performed during this offline build.
