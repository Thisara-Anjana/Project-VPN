# USB VPN Bridge (Tetrd-Style Android & Windows USB Internet Tethering)

A high-performance, non-root USB internet tethering application suite for Android and Windows. It allows sharing an Android phone's active internet connection—including active VPN tunnels such as **NetMod VPN**—with the entire Windows PC over a USB cable with one click.

---

## 1. Prerequisites and Required Software

| Component | Minimum Version | Verified Environment | Path / Notes |
| :--- | :--- | :--- | :--- |
| **Operating System** | Windows 10 / 11 64-bit | Windows 11 Build 26300 AMD64 | Fully compatible with Wintun |
| **Node.js** | `>= 20.0.0` | `v24.22.0` | Node.js runtime for desktop client |
| **npm** | `>= 10.0.0` | `11.19.1` | Package manager |
| **Java / JDK** | JDK 17 or JDK 21 | Temurin 21.0.12.1 | `C:\Users\thisa\.jdks\temurin-21.0.12.1` |
| **Android Debug Bridge** | ADB v1.0.41+ | `C:\platform-tools\adb.exe` | Verified with connected device |
| **Android Device** | Android 8.0+ (API 26+) | Nothing Phone (2a) / Android 16 | USB debugging authorized |
| **Android SDK** | SDK Platform 35 / Build-Tools | Pending Installation | Required to build APK (`ANDROID_HOME`) |

---

## 2. Repository Structure

```
G:\Project VPN/
├── android-app/        # Android Native Application (Kotlin, Material 3, Foreground Service)
│   ├── app/            # Application module, views, MVVM ViewModel, and Protocol contracts
│   ├── gradle/         # Gradle wrapper v8.11.1
│   ├── gradlew.bat     # Windows Gradle wrapper script
│   └── build.gradle.kts# AGP 8.7.3 & Kotlin 2.1.0 build configuration
├── windows-client/     # Desktop Application (Electron, React, TypeScript, Vite)
│   ├── electron/       # Main & Preload scripts (Isolated IPC, no remote execution)
│   ├── src/            # React UI components (Dashboard, DeviceCard, StatsGrid, Logs)
│   └── package.json    # Build & dev scripts
├── network-core/       # Native Routing & Packet Processing Engine (sing-box / Wintun)
├── shared-protocol/    # IPC contracts, length-prefixed framing, telemetry schemas, tests
├── docs/               # System architecture, research, benchmarks, security guides
├── tests/              # End-to-end and integration test suites
├── README.md           # Project documentation and developer guides
├── ARCHITECTURE.md     # Deep-dive technical architecture and data flow
├── FEASIBILITY_REPORT.md # Technical feasibility analysis and constraint evaluations
├── DEVELOPMENT_ROADMAP.md # Step-by-step phased development plan
└── PHASE_2_REPORT.md   # Phase 2 implementation and verification results
```

---

## 3. Development Setup & Build Instructions

### 3.1 Shared Protocol
The shared communication protocol defines binary length-prefixed framing (4-byte length + UTF-8 JSON) and control message schemas.

```powershell
# Navigate to shared protocol directory
cd "G:\Project VPN\shared-protocol"

# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run automated framing and serialization test suite
npm test
```

### 3.2 Windows Desktop Client
The Windows desktop application uses Electron + React + Vite + TypeScript.

```powershell
# Navigate to windows client directory
cd "G:\Project VPN\windows-client"

# Install dependencies
npm install

# Run TypeScript typecheck / lint
npm run lint

# Build renderer and Electron main process
npm run build

# Launch the desktop application
npm run start
```

### 3.3 Android Application
The Android mobile client uses Kotlin, Gradle 8.11.1, and Material 3 with a dedicated Foreground Service.

```powershell
# Navigate to android application directory
cd "G:\Project VPN\android-app"

# Verify Gradle wrapper
.\gradlew.bat --version

# Build debug APK (requires ANDROID_HOME set to valid Android SDK)
.\gradlew.bat assembleDebug
```

> **Note on Android SDK Setup**:
> If the Android SDK is not installed on the build machine, define `ANDROID_HOME` or create `local.properties` with:
> ```properties
> sdk.dir=C:\\Users\\<Username>\\AppData\\Local\\Android\\Sdk
> ```

---

## 4. Current Phase & Verified Status

- **Current Stage**: **Phase 6 One-Click Application Integration Verified**.
- **Verified One-Click Desktop Tethering**: Single primary Connect/Disconnect button in the Windows Electron UI triggers the 15-step `ConnectionOrchestrator` pipeline, managing ADB port forwarding, control handshake, elevated Wintun TUN launch, routing failover, and telemetry synchronization.
- **Full-PC System-Wide TCP Tethering**: Proxy-free Windows applications (browsers, CLI tools, background updaters) automatically route 100% of TCP traffic through the Android phone's active **NetMod VPN** tunnel (`tun0` exiting at Singapore node `91.192.81.167`) without requiring any manual proxy settings.
- **Verified Multi-Host Browsing & Concurrency**:
  - Multi-host browsing verified across `api.ipify.org`, `cloudflare.com`, and `httpbin.org`.
  - 4 concurrent TCP connections verified with 100% NetMod VPN routing match in 1.67 seconds.
  - Controlled 5 MB download benchmark achieved **11.33 Mbps** sustained throughput over USB.
- **Rock-Solid Watchdog Stability**:
  - Android watchdog set to 10 seconds; Windows heartbeat client configured for 6 pings (>9.0s).
  - All command runners use non-blocking asynchronous promises, preventing event loop starvation during multi-second transfers.
- **Network Engine Subsystem (`network-core/`)**:
  - Official engine: `sing-box` (v1.14.4 amd64) + `Wintun` (v0.14.1 x64, signed by WireGuard LLC).
  - TUN MTU: 1500 bytes for standard cellular and mobile VPN compatibility.
  - Route-loop prevention: Strict exclusions for `127.0.0.0/8`, `adb.exe`, and physical gateway IP (`192.168.8.1/32`). User applications (`electron.exe`, browsers) are never bypassed.
  - Unsupported UDP policy: Blocks non-DNS UDP (prevents leaks; forces TCP fallback).
  - IPv6 leak policy: Local blackhole active (prevents leaks outside IPv4 NetMod VPN).
  - Read-only network inspector: Scans adapters, routes, and metrics without mutating system state.
  - Multi-VPN preservation: Explicitly preserves existing VPN adapters (`TAP-Windows Adapter V9`, `TunnelBear`).
  - Standalone emergency recovery scripts: UAC self-elevating `restore-routes.bat` and `restore-routes.ps1` in `network-core/state/`.
- **UI Diagnostics & Telemetry Pipeline**: 5 status badges integrated into the Windows dashboard (USB Control, Android Proxy, Windows Tunnel, Internet Sharing, VPN Routing), 5-card measured telemetry grid, and a one-click emergency "Restore Network" button.
- **Idempotent Fail-Closed Restoration**: Graceful one-click disconnect safely shuts down the TUN supervisor, removes virtual routes, restores the physical default gateway, and flushes DNS caches without lingering leaks. Direct ISP IP (`175.157.44.220`) is 100% restored.
