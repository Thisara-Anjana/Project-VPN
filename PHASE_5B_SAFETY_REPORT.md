# USB VPN Bridge — Phase 5B Safety Report
## Final Pre-Activation Safety Corrections & Verification

**Project:** USB VPN Bridge (Tetrd/PdaNet-Style Non-Root Android & Windows USB Internet Tethering)  
**Host Environment:** Windows 11 Build 26300 AMD64 | Android 16 (Nothing Phone (2a))  
**Date:** November 19, 2026  
**Status:** **SAFETY AUDIT & PREPARATION COMPLETE** (System routes and TUN interface remain strictly untouched until explicit user authorization)

---

## 1. Exact Changes Made

In response to the pre-activation safety review, the following architectural and code corrections were implemented:

1. **MTU Setting Clamped to Standard 1500**:
   - Replaced proposed jumbo frame MTU (`9000`) with standard Ethernet MTU (`1500`) in `ConfigManager.DEFAULT_TUN_MTU`.
   - Guaranteed packet compatibility with cellular networks, Android kernel MTU constraints, and NetMod encapsulation headers.
2. **Strict Route-Loop Exclusions Refined (Zero False-Exclusions)**:
   - **Removed `electron.exe` and `usb-vpn-bridge.exe` from route exclusions**. Only low-level transport daemons (`adb.exe` and `sing-box.exe`) are excluded. This ensures desktop app web requests and diagnostics cannot accidentally bypass the tunnel.
   - **Removed broad RFC 1918 private network bypass (`ip_is_private: true`)**. Replaced with a targeted single-IP exclusion for the dynamically detected physical default gateway (`192.168.8.1/32`), ensuring internal and private subnets cannot leak outside the VPN.
3. **Dynamic State Capture & UAC Self-Elevating Recovery Scripts**:
   - Refactored `RouteRestorer` to eliminate hardcoded gateway IP values, dynamically restoring the active physical gateway (`192.168.8.1`, metric `35`) captured immediately prior to activation.
   - Added automatic UAC Administrator elevation (`net session` check + `Start-Process cmd.exe ... -Verb RunAs`) to [restore-routes.bat](file:///G:/Project%20VPN/network-core/state/restore-routes.bat).
   - Added DNS cache flush (`ipconfig /flushdns`) upon restoration.
4. **Fail-Safe / Kill-Switch Architecture Defined**:
   - Established distinct handling for deliberate user disconnection vs unexpected connection failure (USB cable unplugged, NetMod disconnection, daemon crash).
5. **UI Emergency Action Integrated**:
   - Added an easy-to-find **"Restore Network"** button to the Windows client Pipeline State bar for instant one-click rollback.

---

## 2. TUN MTU Configuration

- **Configured Initial MTU**: `1500` bytes.
- **Justification**:
  - Standard Ethernet MTU is 1500 bytes. Mobile cellular carriers (and VPN encapsulation layers like WireGuard, SSH, V2Ray, Shadowsocks utilized by NetMod) typically enforce an MTU between 1420 and 1500 bytes.
  - Setting a virtual adapter MTU to 9000 before confirming end-to-end Path MTU Discovery (PMTUD) risks silent TCP black-holing, fragmentation failures, and packet drops.
  - Setting the Wintun adapter MTU to 1500 ensures reliable, leak-free packet transmission.
- **Future MTU Optimization**:
  - Clamp MSS / MTU tuning benchmarks will be performed only *after* live basic routing is successfully proven.

---

## 3. Route-Loop Prevention Strategy

Route-loop prevention is achieved through strict, minimal exceptions:

| Traffic Rule | Target / Match | Outbound | Architectural Justification |
| :--- | :--- | :--- | :--- |
| **Native Daemon Exclusion** | `process_name: ["adb.exe", "sing-box.exe"]` | `direct-out` | `adb.exe` communicates with the physical phone over USB hardware endpoints (WinUSB / bulk transfer). `sing-box.exe` binds its outbound sockets to the physical adapter / loopback. User applications (`electron.exe`, Chrome, Edge, etc.) are **NEVER** excluded. |
| **Loopback Transport Exclusion** | `ip_cidr: ["127.0.0.0/8"]` | `direct-out` | The local ADB forwarder port (`127.0.0.1:10808`) and ADB daemon server (`127.0.0.1:5037`) communicate exclusively over loopback (Interface Index 1). Bypassing TUN avoids an infinite recursive routing loop. |
| **Targeted Gateway IP Exclusion** | `ip_cidr: ["192.168.8.1/32"]` | `direct-out` | Bypasses **only** the single physical router IP to maintain local ARP/NDP and keep the physical network link healthy. Broad private IP bypasses (`10.0.0.0/8`, `192.168.0.0/16`) were removed to prevent leaks. |
| **Default System TCP** | `network: "tcp"` | `socks-out` | Intercepts all Windows TCP application traffic (ports 80, 443, etc.) and routes it into the USB SOCKS5 relay (`127.0.0.1:10808`). |

---

## 4. DNS and UDP Behavior

### 1. DNS Resolution Path
- **Configuration**:
  - Virtual DNS Address assigned to Wintun adapter (`172.19.0.2:53`).
  - Sing-box 1.14 typed DNS server:
    ```json
    {
      "tag": "remote-dns",
      "type": "tcp",
      "server": "1.1.1.1",
      "server_port": 53,
      "detour": "socks-out"
    }
    ```
- **Packet Flow**:
  1. Windows applications issue DNS queries (port 53).
  2. Wintun intercepts the query and passes it to sing-box.
  3. Sing-box DNS client resolves queries **over TCP** through `socks-out` (`127.0.0.1:10808`).
  4. The Android SOCKS5 proxy creates a standard TCP socket exiting through NetMod's `tun0`.
  5. In addition, sing-box's route rule `action: "sniff"` extracts domain names from TLS SNI and HTTP Host headers, enabling domain-based SOCKS5 requests (`reqAtyp: 0x03`) that resolve remotely on Android.

### 2. Unsupported UDP Handling (Zero-Leak Policy)
- **Technical Constraint**: The Android SOCKS5 proxy implements RFC 1928 TCP `CONNECT` only (`reqCmd: 0x01`). UDP ASSOCIATE is not supported.
- **Enforced Policy**:
  ```json
  {
    "network": "udp",
    "outbound": "block-out"
  }
  ```
  All non-DNS UDP traffic is explicitly blocked locally.
- **Security & User Experience**:
  - UDP packets are never permitted to leak through physical Ethernet / Wi-Fi.
  - Protocols like HTTP/3 (QUIC) instantly detect blocked UDP and cleanly fall back to HTTP/2 over TCP / TLS.
  - Gaming or VoIP applications that strictly require raw UDP fail explicitly and safely rather than leaking unencrypted data outside NetMod VPN.

### 3. IPv6 Leak Prevention
- **Enforced Policy**:
  ```json
  {
    "ip_version": 6,
    "outbound": "block-out"
  }
  ```
  Combined with `strategy: "ipv4_only"` on sing-box DNS.
- **Protection**: Eliminates dual-stack leaks over physical network interfaces that support IPv6 (`Realtek PCIe GbE` has IPv6 `2402:4000:...`).

---

## 5. Network State Restoration Implementation

### Dynamic Baseline Captured
`NetworkInspector.inspectNetwork()` dynamically records:
- **Primary Physical Interface**: `Ethernet` (`Realtek PCIe GbE Family Controller`, Index `14`, MAC `00-D8-61-6D-CB-8D`).
- **Dynamic Default Gateway**: `192.168.8.1`.
- **Dynamic Route Metric**: `35`.
- **Existing Third-Party VPNs Preserved**: `Local Area Connection` (`TAP-Windows Adapter V9`, OpenVPN).
- **Snapshot Path**: [network-core/state/network-state-snapshot.json](file:///G:/Project%20VPN/network-core/state/network-state-snapshot.json).

### Out-of-Process Emergency Recovery Scripts
Two standalone scripts reside in `network-core/state/`:
1. **[restore-routes.bat](file:///G:/Project%20VPN/network-core/state/restore-routes.bat)**:
   - Self-elevates to Administrator via UAC prompt if double-clicked by standard user.
   - Disables lingering `usb-vpn-tun` adapter.
   - Deletes transient TUN default route (`172.19.0.1`).
   - Restores original default gateway `192.168.8.1` with metric `35` on Interface `14`.
   - Flushes DNS resolver cache (`ipconfig /flushdns`).
   - Preserves all third-party VPNs.
2. **`restore-routes.ps1`**: PowerShell equivalent with role-based elevation verification.

---

## 6. Unexpected Disconnect & Failure Recovery Strategy

We strictly distinguish between two operational states:

```
[Normal Disconnect (User Action)]
  User clicks "Disconnect" in UI
  → sing-box engine stops gracefully
  → Wintun adapter removed
  → Physical gateway metric restored to 35
  → Physical internet restored cleanly

[Unexpected Failure (Cable Unplugged / NetMod Disconnected / Daemon Crash)]
  Watchdog triggers (> 4.5s heartbeat silence or SOCKS5 connection refused)
  → "Fail-Closed" / Kill-Switch active:
  → Does NOT silently revert to unencrypted physical Ethernet!
  → Status changes to RED ("VPN Tunnel Lost - Traffic Blocked")
  → User is prompted with two clear options:
      1. Reconnect USB cable to resume VPN tethering.
      2. Click "Restore Normal Network" to deliberately restore physical internet.
```

---

## 7. Actual Pre-Activation Test Results

| Test Category | Executed Command / Suite | Result | Verified Metric / Detail |
| :--- | :--- | :--- | :--- |
| **Config Syntax Check** | `sing-box.exe check -c sing-box-config.json` | **PASS (Exit 0)** | Zero errors, zero warnings. MTU 1500 accepted. |
| **Route-Loop Audit** | `tests/test_network_core.mjs` (Group 1) | **PASS** | `127.0.0.0/8` & `adb.exe` excluded; `electron.exe` NOT bypassed. |
| **Binary Verification** | `sing-box.exe version` + Wintun Authenticode | **PASS** | sing-box v1.14.4 (Go 1.26.10); Wintun v0.14.1 signed by WireGuard LLC. |
| **Read-Only Inspection** | `NetworkInspector.inspectNetwork()` | **PASS** | 6 adapters detected; dynamic gateway `192.168.8.1` identified. |
| **Recovery Scripts** | `RouteRestorer.saveRecoveryScripts()` | **PASS** | BAT script verified with UAC elevation self-request. |
| **Rollback Simulation** | `RouteRestorer.checkPendingRestoration()` | **PASS** | Detected pending state and marked resolved cleanly. |
| **Shared Protocol** | `node --test dist/*.test.js` | **PASS** | 6/6 framing & envelope tests passed in 7.0ms. |
| **Windows Client Build** | `npm run build` (Vite + Electron) | **PASS** | Compiled in 3.87s with 0 errors. |
| **Physical SOCKS5 Egress**| `curl.exe --proxy socks5h://127.0.0.1:10808` | **PASS** | **Egress IP: 91.192.81.167 (Singapore NetMod node)** |

---

## 8. Remaining Risks & Mitigations

1. **Risk: UAC Elevation Requirement**:
   - *Detail*: Wintun driver creation and routing metric adjustments require administrative privileges.
   - *Mitigation*: Electron main process will spawn `sing-box.exe` using elevated context, or user can run the Windows client as Administrator.
2. **Risk: Temporary Route Stagnation on Crash**:
   - *Detail*: If the Windows host experiences sudden power loss while TUN is active.
   - *Mitigation*: On next boot, Windows Wintun driver automatically deletes transient adapters when no process holds an open handle. Additionally, running `restore-routes.bat` immediately restores default route metrics with one click.
3. **Risk: Applications Bound to Physical Interface**:
   - *Detail*: A few low-level diagnostic tools bind explicitly to physical IP (`192.168.8.192`).
   - *Mitigation*: Standard Windows consumer applications (browsers, email, gaming, download managers) do not bind to specific interfaces and naturally follow the default route.

---

## 9. Proposed Supervised First-Activation Steps (10-Step Procedure)

When you grant explicit approval, the first activation will proceed under a short, supervised test window:

1. **Step 1 — Verify USB Control**: Confirm green "Phone Connected" state on Windows desktop client.
2. **Step 2 — Verify SOCKS5 Channel**: Confirm SOCKS5 relay responds on `127.0.0.1:10808`.
3. **Step 3 — Baseline NetMod Egress Check**: Run `curl.exe --proxy socks5h://127.0.0.1:10808 https://api.ipify.org` and confirm `91.192.81.167`.
4. **Step 4 — Final Network Snapshot**: Capture immediate pre-activation routing state.
5. **Step 5 — Start TUN Engine**: Launch `sing-box.exe run` with Wintun adapter `usb-vpn-tun` (MTU 1500) and `auto_route: true`.
6. **Step 6 — Verify Virtual Adapter**: Verify `usb-vpn-tun` interface is Up with IP `172.19.0.1/30`.
7. **Step 7 — Verify Route Table**: Check that `0.0.0.0/0` points to `usb-vpn-tun` with lower metric than `35`.
8. **Step 8 — Controlled Single HTTPS Request (No Proxy Flag)**:
   - Execute: `curl.exe https://api.ipify.org` (WITHOUT `--proxy` flag).
   - Expected Output: **`91.192.81.167`**.
   - This proves that unmodified Windows application traffic is captured by TUN and routed through NetMod VPN!
9. **Step 9 — Controlled Disconnect**:
   - Stop TUN engine.
   - Verify `usb-vpn-tun` adapter is destroyed.
   - Verify default route reverts to `192.168.8.1` with metric `35`.
10. **Step 10 — Post-Restoration Verification**:
    - Execute `curl.exe https://api.ipify.org` (without proxy).
    - Expected Output: Local Sri Lanka Telecom IP `175.157.16.142`.
    - Confirms 100% clean network restoration.

---

### Strict Restriction Maintained
**No network drivers were installed, no TUN adapters were created, and no system routes or DNS settings were modified during this turn.**

We are stopped and ready. Awaiting your approval to initiate the supervised 10-step activation test.
