# USB VPN Bridge — Control Channel Protocol Specification (v1.0)

## 1. Overview
The Control Channel coordinates session establishment, capability negotiation, live telemetry, and state recovery between the Windows Desktop Client and the Android Foreground Relay Service over an ADB TCP-forwarded link (default: `127.0.0.1:10809`).

## 2. Framing Specification
To protect against TCP stream fragmentation and packet boundary coalescing, all control frames utilize a fixed-length header:

```
+------------------------------+---------------------------------------+
|  Length (4 Bytes Big-Endian)  |      UTF-8 JSON Encoded Payload       |
+------------------------------+---------------------------------------+
|          [0 ... 3]           |             [4 ... 4 + N]             |
+------------------------------+---------------------------------------+
```

- **Length Field**: 32-bit unsigned integer (big-endian) denoting the exact byte length `N` of the JSON payload.
- **Max Message Size**: 65,536 bytes (64 KB). Any frame header advertising a length greater than 64 KB is rejected immediately, and the receiving buffer is purged to prevent memory exhaustion attacks.
- **Wire Format**: Standard UTF-8 encoded JSON.

## 3. Message Envelope Structure
Every control message is enveloped in a standardized container:

```json
{
  "version": "1.0",
  "id": "msg_m0abc123_4f89x",
  "type": "MESSAGE_TYPE",
  "timestamp": 1773878400000,
  "payload": { ... }
}
```

- `version`: Protocol version string (`"1.0"`).
- `id`: Unique correlation identifier. For request-response pairs, the response message sets this ID to match the initiating request's ID.
- `type`: One of the enumerated message types.
- `timestamp`: Unix epoch time in milliseconds.
- `payload`: Type-specific object schema.

## 4. Message Types and Schemas

### 4.1 HELLO & HELLO_ACK
- **Direction**: Windows $\rightarrow$ Android (`HELLO`), Android $\rightarrow$ Windows (`HELLO_ACK`).
- **Purpose**: Handshake initialization, capability negotiation, and session assignment.

```json
// HELLO
{
  "version": "1.0",
  "id": "msg_001",
  "type": "HELLO",
  "timestamp": 1773878400000,
  "payload": {
    "protocolVersion": "1.0",
    "clientId": "win-desktop-client-uuid",
    "clientType": "WINDOWS_CLIENT",
    "clientVersion": "1.0.0",
    "capabilities": ["SOCKS5", "UDP", "METRICS_V1"]
  }
}
```

### 4.2 DEVICE_INFO
- **Direction**: Android $\rightarrow$ Windows.
- **Purpose**: Telemetry regarding the connected mobile device, battery, OS, and NetMod package presence.

```json
{
  "version": "1.0",
  "id": "msg_002",
  "type": "DEVICE_INFO",
  "timestamp": 1773878400100,
  "payload": {
    "model": "A142",
    "manufacturer": "Nothing",
    "osVersion": "16",
    "apiLevel": 36,
    "batteryLevel": 85,
    "isCharging": true,
    "netModInstalled": true,
    "netModVersion": "Syna 2.1"
  }
}
```

### 4.3 STATUS
- **Direction**: Android $\rightarrow$ Windows (periodic / on-state-change).
- **Purpose**: Streaming metrics: connection state, NetMod VPN state, live speeds, active sockets.

```json
{
  "version": "1.0",
  "id": "msg_003",
  "type": "STATUS",
  "timestamp": 1773878401000,
  "payload": {
    "connectionState": "TETHERING_ACTIVE",
    "netModStatus": "ACTIVE_VPN",
    "bytesReceived": 10485760,
    "bytesSent": 2097152,
    "speedDownloadBps": 45000000,
    "speedUploadBps": 8500000,
    "activeSockets": 24,
    "uptimeSeconds": 300,
    "relayPort": 10808
  }
}
```

### 4.4 CONNECT_REQUEST & CONNECT_RESPONSE
- **Direction**: Windows $\rightarrow$ Android (`CONNECT_REQUEST`), Android $\rightarrow$ Windows (`CONNECT_RESPONSE`).
- **Purpose**: Initiates tethering session and verifies NetMod routing.

```json
// CONNECT_REQUEST
{
  "version": "1.0",
  "id": "msg_004",
  "type": "CONNECT_REQUEST",
  "timestamp": 1773878402000,
  "payload": {
    "requestedDataPort": 10808,
    "enableUdp": true,
    "enableDnsProxy": true,
    "clientTimestamp": 1773878402000
  }
}
```

### 4.5 DISCONNECT_REQUEST
- **Direction**: Bidirectional.
- **Purpose**: Graceful session termination.

### 4.6 HEARTBEAT
- **Direction**: Bidirectional (Interval: 1000ms).
- **Purpose**: RTT latency measurement and disconnect detection (<1500ms threshold).

### 4.7 ERROR
- **Direction**: Bidirectional.
- **Purpose**: Error signaling with standard error codes (`ERR_VERSION_MISMATCH`, `ERR_NETMOD_DISCONNECTED`, etc.).

## 5. Connection State Machine

```
   [DISCONNECTED]
          │
    (Device plugged in & ADB detected)
          ▼
  [DEVICE_DETECTED]
          │
      (Send HELLO)
          ▼
    [HANDSHAKING]
          │
    (Receive HELLO_ACK)
          ▼
  [CONNECTED_IDLE] ◄────────────────┐
          │                         │
  (Click Connect)            (Click Disconnect)
          ▼                         │
  [STARTING_TETHER]                 │
          │                         │
 (Receive CONNECT_RESPONSE OK)      │
          ▼                         │
  [TETHERING_ACTIVE] ───────────────┘
          │
  (USB Unplugged or Error)
          ▼
   [ERROR_STATE] / [RECONNECTING]
          │
    (Timeout / Abort)
          ▼
    [DISCONNECTED]
```
