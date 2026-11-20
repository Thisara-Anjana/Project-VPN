# USB VPN Bridge — Windows System Tray Background Mode Report

**Project Root:** `G:\Project VPN`  
**Date:** November 20, 2026  
**Implementation:** PdaNet+-style Windows System Tray & Background Tethering Mode  
**Status:** Completed, Verified & Packaged  

---

## 1. Executive Summary

The Windows Electron client for **USB VPN Bridge** has been enhanced with a native **Windows System Tray (Hidden Icons ^) background mode**, mirroring the behavior of **PdaNet+** and professional network companion tools.

### Key Functional Behaviors
1. **Normal Startup:** Launching the application opens the main window normally on the desktop. No network routes or adapters are touched on startup without explicit user interaction.
2. **Minimize to System Tray:** Clicking the Minimize button (`_`) on the window title bar hides the window from the Windows taskbar directly into the System Tray, leaving zero taskbar clutter while tethering runs uninterrupted in the background.
3. **Close (X) to System Tray:** Clicking the window close button (`X`) hides the window to the System Tray instead of terminating the process, preventing accidental network disconnection during active internet tethering.
4. **Permanent System Tray Presence:** A persistent System Tray icon is maintained throughout execution, visually indicating whether the bridge is Disconnected, Connecting, Connected, or in Error.
5. **Double-Click & Click to Reopen:** Double-clicking or clicking the tray icon restores, unhides, and focuses the main window, immediately synchronizing the latest live network metrics.
6. **Tray Context Menu:** Right-clicking the tray icon displays a native context menu:
   - **Open USB VPN Bridge:** Restores and brings the main window forward.
   - **Status: [Current State]:** Dynamic, real-time connection status label.
   - **Connect:** Initiates one-click USB VPN tethering.
   - **Disconnect:** Safely stops the tunnel and restores normal Windows networking.
   - **Exit:** Gracefully terminates tethering, restores original network routes/DNS, cleans up session locks, and exits the application.
7. **Single-Instance Enforcement:** Protected by Electron's native `app.requestSingleInstanceLock()`. Launching the executable a second time brings the existing window to the front rather than creating conflicting duplicate processes or duplicate tray icons.
8. **Emergency Network Safety on Exit:** If an issue occurs during exit route restoration, the application alerts the user via a native dialog box and preserves the standalone `restore-routes.bat` script rather than silently exiting in a broken network state.

---

## 2. Technical Architecture & Implementation Details

```
                          WINDOWS 10/11 TASKBAR & SYSTEM TRAY
                                      ┌──────────┐
                                      │ System   │
                                      │ Tray (^) │
                                      └────┬─────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    │                                             │
      Left-Click / Double-Click                      Right-Click Context Menu
                    │                                             │
                    ▼                                             ▼
        restoreMainWindow()                        ├── Open USB VPN Bridge
        ├── mainWindow.restore()                   ├── Status: [State Label]
        ├── mainWindow.show()                      ├── Connect
        ├── mainWindow.focus()                     ├── Disconnect
        └── syncRendererState()                    └── Exit (graceful restore)
                    │                                             │
                    └──────────────────────┬──────────────────────┘
                                           │
                          ELECTRON MAIN PROCESS RUNTIME
    ┌─────────────────────────────────────────────────────────────────────────────┐
    │                                                                             │
    │  • Single-Instance Guard: app.requestSingleInstanceLock()                   │
    │  • Window Interception: minimize -> hide(), close -> hide() (if !isQuitting)│
    │  • Background Immunity: powerSaveBlocker ("prevent-app-suspension")         │
    │  • Renderer Throttling Disabled: webPreferences.backgroundThrottling: false │
    │  • Heartbeat Watchdog: 25s threshold across Android USB link                │
    │  • Device Poller: Main process background poll -> adb:devices-changed       │
    │  • Native TUN Supervisor: sing-box v1.14.4 + Wintun v0.14.1 (usb-vpn-tun)  │
    │                                                                             │
    └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Files Modified & Created

### 1. `windows-client/electron/main.ts`
- Added Electron `Tray`, `Menu`, and `dialog` imports.
- Enforced `app.requestSingleInstanceLock()`; secondary instances immediately focus the existing window and terminate.
- Initialized `createTray()` on application startup with state-aware icon, tooltip, and context menu.
- Added non-destructive window event listeners:
  - `mainWindow.on("minimize")`: Hides window from taskbar to tray.
  - `mainWindow.on("close")`: Intercepts X button when `!isQuitting` and hides window to tray.
  - `mainWindow.on("restore")` & `focus`: Restores minimized state and pushes fresh status to React UI.
- Implemented `handleApplicationExit()`: Disconnects orchestrator, restores original physical routes and DNS, removes ADB port forwards, cleans up session locks, warns user on error, and destroys tray icon.
- Handled `window-all-closed`: Does not quit when windows are hidden, keeping background tethering active.
- Integrated `updateTrayMenu()` into orchestrator and control-client state-change callbacks.

### 2. `windows-client/electron/trayIcons.ts` (New Module)
- Implemented `getTrayIcon(state: ConnectionState)` returning state-specific `NativeImage` objects:
  - **Connected:** Emerald green shield with active checkmark.
  - **Disconnected:** Sleek slate/blue shield.
  - **Connecting / Recovering:** Amber/orange status indicator.
  - **Error:** Crimson red warning indicator.
- Implemented `getStatusTooltip(state)` providing accurate tooltips in the Windows taskbar overflow menu.
- Implemented `getStatusMenuLabel(state)` formatting dynamic context menu labels.
- Structured with optional chaining and fallback handling so icons load reliably in both packaged and unpackaged environments.

### 3. `windows-client/assets/` & `scripts/generate-icons.mjs` (New Assets)
- Generated crisp 32x32 RGBA PNG icon assets:
  - `tray-disconnected.png`
  - `tray-connected.png`
  - `tray-connecting.png`
  - `tray-error.png`
- Configured `windows-client/package.json` to bundle `assets/**/*` in `build.files` and `build.extraResources`.

### 4. `tests/test_tray_behavior.mjs` (New Automated Test Suite)
- Validated all 17 system tray operational criteria (single-instance lock, minimize/close interception, context menu items, icon state mapping, tooltips, and graceful teardown).

---

## 4. Test Verification Results

All 64 tests across 5 independent test suites passed with zero failures:

| Test Suite | Focus Area | Tests | Result |
|---|---|:---:|:---:|
| **`test_tray_behavior.mjs`** | Single-instance lock, minimize/close-to-tray, tray menu, icon states, exit safety | 17 | **PASSED (17/17)** |
| **`test_tetrd_reliability.mjs`** | Orchestrator transition safety, SOCKS5 64KB buffers, persistent WakeLock | 17 | **PASSED (17/17)** |
| **`test_background_stability.mjs`** | Background throttling immunity, powerSaveBlocker, 25s watchdog tolerances | 13 | **PASSED (13/13)** |
| **`test_phase6_orchestrator.mjs`** | Elevated PowerShell supervisor, state transitions, route restorer idempotence | 12 | **PASSED (12/12)** |
| **`test_network_core.mjs`** | sing-box binary check, MTU 1500, emergency recovery scripts, network baseline | 5 | **PASSED (5/5)** |
| **Total Automated Tests** | | **64** | **ALL PASSED (64/64)** |

---

## 5. Build Artifacts & Checksums

The Windows desktop client has been compiled, packaged, and verified into a single installable setup executable:

| Artifact | Target Platform | File Location | SHA256 Hash |
|---|---|---|---|
| **Windows Installer** | Windows 10/11 x64 (NSIS) | `release/USB-VPN-Bridge-Setup.exe` | `16A4470E8AA258BEBD42E5B0EF505CF7FC4A44EC699D43D8D20CE7F8CF2B2F20` |
| **Android APK** | Android 8.0+ (API 26+) | `release/USB-VPN-Bridge.apk` | `ABBCB2287BA4D1332898C3686FA6EC0ABF579A79ECB5CB2D8B3D8D240AE28356` |

*Hashes updated in `release/CHECKSUMS_SHA256.txt`.*

---

## 6. Physical Device Testing Notes

Because the physical Android phone is currently disconnected:
- **Offline & Architectural Verification:** 100% complete. Tray behaviors, window lifecycle events, single-instance mutex, and background networking architecture have been verified via automated test suites.
- **Pending Live Device Verification:**
  1. Plug in Android phone and launch installed `USB VPN Bridge.exe`.
  2. Click **Connect** in main window or right-click Tray icon $\rightarrow$ **Connect**.
  3. Click **Minimize** or **X** on main window; confirm the window hides completely into the Windows System Tray (`^`).
  4. Verify continuous proxy-free internet browsing while window is hidden.
  5. Double-click tray icon to restore window; confirm speed counters and duration are live and accurate.
  6. Right-click tray icon $\rightarrow$ **Exit**; verify that Windows routing and physical internet are safely restored.
