# USB VPN Bridge (Tetrd-Style Android & Windows USB Internet Tethering)

A high-performance, non-root USB internet tethering application suite for Android and Windows. It allows sharing an Android phone's active internet connection—including active VPN tunnels such as **NetMod VPN**—with the entire Windows PC over a USB cable with one click.

---

## Key Highlights

- **Tetrd-Style Performance & Ergonomics**: Simple one-click tethering over USB without carrier hotspot restrictions or root access.
- **NetMod VPN Compatibility**: Preserves NetMod's active `VpnService` on Android by employing a user-space socket relay service rather than registering a competing Android VPN interface.
- **Full-PC System-Wide Routing**: Directs all Windows application traffic (browsers, background services, games, UDP, DNS) through the USB bridge using Windows Wintun driver and sing-box TUN network core.
- **Robust Disaster Recovery**: Automatically restores previous Windows network routes, adapter metrics, and DNS upon disconnection or unexpected termination.
- **High-Performance Architecture**: Zero-copy packet streaming via Wintun kernel ring buffers, asynchronous I/O, bounded memory buffers, and backpressure management.

---

## System Architecture Overview

```
Windows Applications (Browsers, Games, System)
       │ (Layer 3 IP packets: TCP, UDP, DNS)
       ▼
Windows Wintun Virtual Network Adapter
       │
       ▼
sing-box TUN Engine (network-core)
       │ Translates L3 IP packets into proxied streams (SOCKS5/Multiplexed)
       ▼
Localhost Port Forward / Transport Layer (ADB / Bidirectional USB TCP)
       │ USB Cable
       ▼
Android Foreground Relay Service (android-app)
       │ Normal User-Space Socket I/O (No root, No VpnService conflict)
       ▼
Android OS Networking Stack & NetMod VPN (tun0)
       │ Encrypted Egress
       ▼
Internet
```

---

## Repository Structure

```
G:\Project VPN/
├── android-app/        # Android Native Application (Kotlin, Material 3, Foreground Service)
├── windows-client/     # Desktop Application (Electron, React, TypeScript)
├── network-core/       # Native Routing & Packet Processing Engine (sing-box / Wintun)
├── shared-protocol/    # IPC contracts, handshake definitions, telemetry schemas
├── docs/               # System architecture, research, benchmarks, security guides
├── tests/              # End-to-end, network stress, and unit test suites
├── README.md           # Project introduction and overview
├── ARCHITECTURE.md     # Deep-dive technical architecture and data flow
├── FEASIBILITY_REPORT.md # Technical feasibility analysis and constraint evaluations
└── DEVELOPMENT_ROADMAP.md # Step-by-step phased development plan
```

---

## Current Status

- **Phase 1: Research, Environment Inspection, and Architecture Design** (Completed).
- Next Step: **Phase 2 — Application Foundations** (Android and Windows application skeletons and shared protocol contracts).
