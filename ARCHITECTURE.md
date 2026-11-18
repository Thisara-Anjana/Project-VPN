# System Architecture Specification

## 1. Architectural Philosophy & Tetrd Comparative Analysis

### 1.1 How Tetrd Operates
Public research reveals how Tetrd achieves high-performance non-root tethering:
- **Reverse Tethering (PC → Phone)**: Tetrd activates Android's `VpnService` to capture outbound mobile device traffic at Layer 3 and pumps IP packets down the USB cable to a PC gateway.
- **Forward Tethering (Phone → PC)**: Tetrd **does not** require an Android `VpnService`. Instead, an Android foreground service receives incoming network connection requests from the USB transport and establishes regular outbound client sockets over the phone's active data interface (Wi-Fi or cellular).
- **Windows Integration**: Tetrd deploys the Microsoft-signed **Wintun** driver (`wintun.dll`) to establish a virtual network adapter on Windows, intercepting all Layer 3 IP traffic and forwarding it through a user-space routing engine.

### 1.2 Our Architecture
To fulfill the critical requirement—**sharing an active NetMod VPN connection from Android to Windows without disconnecting NetMod**—our architecture adheres to the following core tenets:
1. **Zero VpnService Conflict**: Android allows only one active `VpnService` per user profile. Activating another `VpnService` immediately revokes NetMod's VPN session. Therefore, our Android application operates strictly as a **high-throughput user-space relay (SOCKS5 / socket proxy)** via an Android `ForegroundService`.
2. **Seamless Tunneling through NetMod**: When our Android relay service creates standard TCP/UDP outbound sockets, the Android kernel naturally routes these sockets through NetMod's active `tun0` interface.
3. **Decoupled Windows Layers**:
   - **UI Layer**: Electron + React + TypeScript provides an intuitive dashboard, device discovery, and telemetry. It **never** touches raw packet buffers.
   - **Supervisor Layer**: Node.js child processes control ADB and the native network core.
   - **Data Plane (Network Core)**: A native Go/C++ engine (`sing-box` with `Wintun`) handles packet capture, TUN routing, TCP/IP stack translation (`gVisor`/`mixed` stack), and proxying.

---

## 2. End-to-End Network Data Plane

```
[Windows Applications]
      │
      │ 1. Raw L3 IP Packets (TCP, UDP, DNS)
      ▼
[Wintun Adapter (sing-tun)]
      │
      │ 2. Ring-buffer kernel-to-user memory copy
      ▼
[sing-box TUN Engine (network-core)]
      │
      │ 3. User-space TCP/IP Stack (gVisor/mixed) converts L3 packets to SOCKS5 streams
      ▼
[Localhost Port 10808 (Loopback)]
      │
      │ 4. Forwarded via ADB Daemon (`adb forward tcp:10808 tcp:10808`)
      ▼
[Physical USB Cable (High-Speed USB Bulk Transfer)]
      │
      ▼
[Android ADB Server Daemon (adbd)]
      │
      │ 5. Localhost loopback delivery
      ▼
[USB VPN Bridge Relay Service (Kotlin NIO / Netty-lite)]
      │
      │ 6. Relay creates normal client socket: Socket(target_ip, target_port)
      ▼
[Android Linux Kernel Network Routing Engine]
      │
      │ 7. Kernel inspects routing table; all app traffic is bound to NetMod's tun0
      ▼
[NetMod VPN Service (tun0)]
      │
      │ 8. NetMod encapsulates & encrypts payload via SSH/V2Ray/Shadowsocks
      ▼
[Physical Cellular / Wi-Fi Interface]
      │
      ▼
[Internet / VPN Egress Gateway]
```

---

## 3. Control Plane Architecture

The control plane coordinates device detection, health checks, metrics, and failure recovery.

```
+-------------------------------------------------------+
|                   Windows Client UI                  |
|               (Electron / React / TS)                 |
+--------------------------┬----------------------------+
                           │ IPC (Status, Speeds, Logs)
                           ▼
+-------------------------------------------------------+
|             Windows Supervisor Process                |
|  - ADB Process Manager (`adb.exe devices`, forward)   |
|  - Core Process Manager (`sing-box.exe run`)          |
|  - Health & Heartbeat Monitor                         |
|  - Network State Sentinel (Route & DNS restoration)   |
+--------------------------┬----------------------------+
                           │ ADB TCP Control Socket (port 10809)
                           ▼
+-------------------------------------------------------+
|             Android Foreground Service                |
|  - Service Notification Lifecycle                     |
|  - Handshake & Authentication Sentinel                |
|  - SOCKS5 / Socket Relay Engine (port 10808)          |
|  - NetMod Status & Egress IP Verifier                 |
|  - Live Bandwidth Counter (Rx / Tx)                   |
+-------------------------------------------------------+
```

---

## 4. Subsystem Breakdown

### 4.1 Windows Network Core (`network-core`)
- **Driver**: `wintun.dll` (v0.14.1, signed by WireGuard LLC / Microsoft).
- **Core Engine**: `sing-box` compiled as a dedicated helper binary (`sing-box.exe`).
- **Routing Engine**:
  - `auto_route: true`: Dynamically configures the Windows routing table to redirect default gateway traffic through `sing-tun`.
  - `strict_route: true`: Enforces route exclusion and prevents packet leakage outside the tunnel.
  - `stack: "mixed"`: Leverages Windows kernel TCP/IP stack for TCP connections and gVisor user-space stack for UDP/DNS encapsulation.
  - `inbounds`: TUN inbound listening on virtual subnet `172.19.0.1/30`.
  - `outbounds`: SOCKS5 client outbound targeting `127.0.0.1:10808`.
  - `dns`: Local DNS server interceptor mapping queries through remote proxy to prevent DNS leaks.

### 4.2 USB Transport Layer
- **Transport Mechanism**: Android Debug Bridge (ADB) TCP Port Forwarding (`adb forward tcp:10808 tcp:10808` and `adb forward tcp:10809 tcp:10809`).
- **Control Channel (Port 10809)**:
  - JSON-over-TCP lightweight handshake.
  - Periodic bidirectional keep-alive ping (interval: 1000ms).
  - Telemetry payload exchange (device model, battery, NetMod status, live byte counters).
- **Data Channel (Port 10808)**:
  - High-concurrency SOCKS5 protocol channel.
  - Zero application-level encapsulation overhead; raw multiplexed TCP streams handled by OS TCP buffers over USB.

### 4.3 Android Relay Service (`android-app`)
- **Type**: Foreground Service with `FOREGROUND_SERVICE_TYPE_DATA_SYNC` or `CONNECTED_DEVICE` under Android 14/15/16.
- **Relay Implementation**: Kotlin Coroutines + Java NIO `AsynchronousServerSocketChannel` or a tailored, lightweight embedded SOCKS5 engine.
- **Socket Dispatch**:
  - Direct Socket Mode: Establishes `SocketChannel.open()` to destination IP/port. The Android kernel transparently directs this connection through NetMod's active `tun0`.
  - Proxy Fallback Mode: If direct sockets are restricted, the relay can route through NetMod's internal SOCKS5/HTTP proxy (e.g. `127.0.0.1:1080`).

---

## 5. Failure Handling and Network State Restoration

One of the most dangerous bugs in custom TUN clients is leaving the host machine with broken default routes or non-resolving DNS if the application crashes or the USB cable is unplugged.

### 5.1 Sentinel Restoration Mechanism
1. **Pre-flight Snapshot**: Prior to bringing up Wintun, the Windows client records:
   - Default IPv4/IPv6 gateway and interface metric.
   - Primary and secondary DNS server addresses for all active adapters.
2. **Process Monitoring**:
   - `sing-box.exe` runs as a monitored child process. If it crashes, the supervisor invokes fallback cleanup scripts (`netsh` / `Set-DnsClientServerAddress`).
3. **Graceful Disconnect Sequence**:
   - Stop `sing-box` gracefully via `SIGINT` / `CTRL_BREAK_EVENT`.
   - `sing-box` tears down `sing-tun` and deletes all routes associated with Wintun.
   - Windows automatically restores the original metric priority of the physical Ethernet/Wi-Fi adapter.
   - Flush DNS cache (`ipconfig /flushdns`).
   - Remove ADB port forwards (`adb forward --remove tcp:10808`).
4. **Physical USB Pull Recovery**:
   - Keep-alive heartbeat detects transport drop within 1.5 seconds.
   - The UI immediately shifts to "Reconnecting / Cable Disconnected" state.
   - Windows client suspends TUN default route temporarily or shuts down the TUN adapter to prevent applications from hanging indefinitely.
