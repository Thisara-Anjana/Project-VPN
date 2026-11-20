# USB VPN BRIDGE — PERSONAL BETA INSTALLATION & USER GUIDE
## Tetrd / PdaNet-Style Non-Root USB Tethering Suite

**Target Environment:** Nothing Phone (2a) (Android 16) & Windows 11 64-bit PC  
**Release Version:** v1.0.0-beta  
**Status:** Personal Beta Testing Only (Not for Production Distribution)

---

## 1. Overview & How It Works

USB VPN Bridge allows you to share your Android phone's active internet connection—specifically including active VPN connections such as **NetMod VPN**—with your Windows PC over a single physical USB cable.

Unlike conventional Android tethering (which bypasses phone VPNs and routes direct mobile data), USB VPN Bridge relays all Windows PC TCP traffic through the Android phone's active VPN tunnel interface (`tun0` exiting at your remote VPN server).

```
[Windows PC Applications]
        │
        ▼ (Virtual TUN Adapter: usb-vpn-tun, MTU 1500)
 [sing-box + Wintun]
        │
        ▼ (SOCKS5 via ADB USB Port Forwarding: 127.0.0.1:10808)
  [USB Cable]
        │
        ▼ (TCP CONNECT SOCKS5 Server: Android Relay Service)
  [Android OS]
        │
        ▼ (Protected Socket Egress: tun0)
 [NetMod VPN Tunnel] ──────► [Internet / Remote VPN Server]
```

---

## 2. Prerequisites

### On Android
- **Device:** Android 8.0+ (Tested on Nothing Phone (2a), Android 16 / API 35).
- **USB Cable:** Standard high-quality data transfer USB-C cable (ensure it supports data, not charging-only).
- **Developer Options & USB Debugging:** Enabled on your phone.
- **Mobile VPN:** NetMod VPN (or similar Shadowsocks/V2Ray client) configured and working.

### On Windows
- **Operating System:** Windows 10 or Windows 11 64-bit (Tested on Windows 11 Build 26300 AMD64).
- **User Account:** Standard user account with ability to approve Windows UAC prompts.
- **Administrator Access:** Required ONLY when activating or deactivating the virtual TUN network adapter (via standard UAC prompt).

---

## 3. Step-by-Step Installation

### Step A: Install the Android Beta App
1. Transfer `USB-VPN-Bridge-Android-Beta.apk` to your phone (or download directly via browser/drive).
2. Tap the APK file to install.
   - *Note:* If prompted with "Install unknown apps", grant permission for your file manager or browser.
3. Open **USB VPN Bridge** on your Android phone.
4. Grant the requested **Notification Permission** (required for the Android Foreground Service to maintain background connectivity).

### Step B: Install the Windows Desktop Client
1. Run `USB-VPN-Bridge-Setup-Beta.exe` on your Windows 11 PC.
2. Follow the NSIS setup wizard. You may choose your preferred installation directory or keep the default.
3. Check the options to create Desktop and Start Menu shortcuts.
4. Complete installation and launch **USB VPN Bridge**.
   - *Note on SmartScreen:* Because this is a personal beta build without an expensive commercial code-signing certificate, Windows SmartScreen may display *"Windows protected your PC"*. Click **More info** $\rightarrow$ **Run anyway**.

---

## 4. Daily Connection Procedure

Follow this exact sequence for smooth operation:

1. **Connect Mobile VPN**:
   - On your Android phone, open **NetMod VPN** and tap **Connect**.
   - Verify that your phone has active VPN internet.
2. **Start Android Relay Service**:
   - Open **USB VPN Bridge** on Android.
   - Tap **START USB SERVICE**.
   - Confirm the persistent notification appears in your status bar (*"USB Relay Active"*).
3. **Connect USB Cable**:
   - Plug the phone into your Windows PC.
   - Set USB mode to *"File Transfer / Android Auto"* or *"No data transfer"* (USB Debugging works in either mode).
4. **Authorize USB Debugging (First Time Only)**:
   - If prompted on your phone: *"Allow USB debugging?"*, check *"Always allow from this computer"* and tap **Allow**.
5. **Launch Windows Client**:
   - Open **USB VPN Bridge** on Windows.
   - The status bar should immediately indicate:
     - `Android Phone: Connected (00058342T000159)`
     - `USB Control: Connected`
     - `Android Proxy: Ready`
6. **Click CONNECT**:
   - Click the large blue **CONNECT** button.
   - Windows will display a User Account Control (UAC) prompt requesting permission for `run-elevated.ps1` (sing-box supervisor).
   - Click **Yes** on the UAC prompt.
7. **Internet Connected**:
   - Within 5–7 seconds, the status badge will change to:
     - `Windows Tunnel: Active`
     - `Internet Sharing: Verified`
     - `VPN Routing: Verified`
   - Your VPN Exit IP will display (e.g., `91.192.81.167`).
8. **Browse Normally**:
   - All PC applications (Chrome, Firefox, Discord, Steam, terminal commands) will now route through your phone's NetMod VPN without any manual proxy settings.

---

## 5. Disconnection Procedure

1. In the Windows client, click the red **DISCONNECT** button.
2. The client will cleanly:
   - Terminate the elevated TUN supervisor daemon.
   - Remove the transient `usb-vpn-tun` default route.
   - Restore your original physical Wi-Fi/Ethernet gateway metric.
   - Flush the Windows DNS resolver cache.
3. Your PC's original physical internet connection is 100% restored.
4. (Optional) On your phone, tap **STOP USB SERVICE** if tethering is no longer needed.

---

## 6. Troubleshooting & Diagnostics

### 1. "Phone Not Detected" or "Offline"
- **Cause:** USB Debugging is not enabled, or cable is loose.
- **Fix:**
  - Verify `Developer options` $\rightarrow$ `USB debugging` is switched ON.
  - Re-plug the USB cable into a different USB port (prefer rear motherboard ports on desktop PCs).
  - Verify phone displays "USB debugging connected".

### 2. "ADB Unauthorized"
- **Cause:** The PC's RSA key has not been approved on the phone screen.
- **Fix:** Unlock your phone and look for the authorization dialog. Tap "Always allow" and "OK".

### 3. "Android Proxy Unavailable"
- **Cause:** Android foreground service is stopped or crashed.
- **Fix:** Open the Android app, verify the service toggle is ON. If not, tap **START USB SERVICE**.

### 4. "Windows Tunnel Error" or UAC Cancelled
- **Cause:** UAC prompt was denied, or PowerShell execution is restricted.
- **Fix:**
  - When you click Connect, you must click **Yes** on the Windows Administrator prompt.
  - If the prompt does not appear, check if it is minimized in the taskbar.

### 5. Emergency Route Restoration (If App Crashes)
If the Windows client is abruptly terminated or crashes during an active session and your PC has no internet:
1. Open Windows File Explorer.
2. Navigate to your user AppData directory:
   `%APPDATA%\USB VPN Bridge\state\` (or `<InstallDir>\resources\bin\recovery\`).
3. Right-click **`restore-routes.bat`** and select **Run as Administrator** (or double-click; it will self-elevate).
4. The script will automatically disable the virtual TUN adapter, delete the tunnel routes, restore your physical default gateway, and flush DNS.

---

## 7. Known Limitations & Beta Scope

- **TCP Only:** Full system TCP traffic is supported. Non-DNS UDP traffic is safely blocked to prevent unencrypted cellular leaks. UDP-based VoIP or competitive gaming may require TCP fallback.
- **IPv6 Blackhole:** IPv6 traffic is blackholed locally to prevent IPv6 leakage outside of NetMod's IPv4 VPN tunnel.
- **Single-Device Target:** Tailored and validated specifically for Nothing Phone (2a) and Windows 11 x64.
- **Personal Beta:** Extended multi-hour stress testing and automated crash kill-switch testing are deferred.
