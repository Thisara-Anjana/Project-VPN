/**
 * USB VPN Bridge - Shared Communication Protocol Specification (v1.0)
 * 
 * Formal definitions for control messages exchanged over the USB transport channel.
 */

export const PROTOCOL_VERSION = "1.0";
export const MAX_MESSAGE_SIZE = 65536; // 64 KB maximum control frame size
export const DEFAULT_CONTROL_PORT = 10809;
export const DEFAULT_DATA_PORT = 10808;

export enum MessageType {
  HELLO = "HELLO",
  HELLO_ACK = "HELLO_ACK",
  DEVICE_INFO = "DEVICE_INFO",
  STATUS = "STATUS",
  CONNECT_REQUEST = "CONNECT_REQUEST",
  CONNECT_RESPONSE = "CONNECT_RESPONSE",
  DISCONNECT_REQUEST = "DISCONNECT_REQUEST",
  HEARTBEAT = "HEARTBEAT",
  ERROR = "ERROR",
}

export enum ConnectionState {
  DISCONNECTED = "DISCONNECTED",
  DEVICE_DETECTED = "DEVICE_DETECTED",
  HANDSHAKING = "HANDSHAKING",
  CONNECTED_IDLE = "CONNECTED_IDLE",
  STARTING_TETHER = "STARTING_TETHER",
  TETHERING_ACTIVE = "TETHERING_ACTIVE",
  STOPPING_TETHER = "STOPPING_TETHER",
  ERROR_STATE = "ERROR_STATE",
  RECONNECTING = "RECONNECTING",
}

export enum NetModStatus {
  NOT_VERIFIED = "NOT_VERIFIED",
  NOT_INSTALLED = "NOT_INSTALLED",
  STOPPED = "STOPPED",
  RUNNING_NO_VPN = "RUNNING_NO_VPN",
  ACTIVE_VPN = "ACTIVE_VPN",
  ACTIVE_PROXY_TETHER = "ACTIVE_PROXY_TETHER",
}

export enum ErrorCode {
  ERR_VERSION_MISMATCH = "ERR_VERSION_MISMATCH",
  ERR_UNAUTHORIZED = "ERR_UNAUTHORIZED",
  ERR_SERVICE_NOT_RUNNING = "ERR_SERVICE_NOT_RUNNING",
  ERR_PORT_IN_USE = "ERR_PORT_IN_USE",
  ERR_NETMOD_NOT_DETECTED = "ERR_NETMOD_NOT_DETECTED",
  ERR_NETMOD_DISCONNECTED = "ERR_NETMOD_DISCONNECTED",
  ERR_TIMEOUT = "ERR_TIMEOUT",
  ERR_INVALID_MESSAGE = "ERR_INVALID_MESSAGE",
  ERR_FRAME_TOO_LARGE = "ERR_FRAME_TOO_LARGE",
  ERR_INTERNAL = "ERR_INTERNAL",
}

// -------------------------------------------------------------
// Message Payloads
// -------------------------------------------------------------

export interface HelloPayload {
  protocolVersion: string;
  clientId: string;
  clientType: "WINDOWS_CLIENT" | "ANDROID_APP";
  clientVersion: string;
  capabilities: string[];
}

export interface HelloAckPayload {
  protocolVersion: string;
  sessionId: string;
  serverVersion: string;
  serverCapabilities: string[];
  accepted: boolean;
  rejectionReason?: string;
}

export interface DeviceInfoPayload {
  model: string;
  manufacturer: string;
  osVersion: string;
  apiLevel?: number;
  batteryLevel?: number;
  isCharging?: boolean;
  netModInstalled: boolean;
  netModVersion?: string;
  vpnActive?: boolean;
}

export interface StatusPayload {
  connectionState: ConnectionState;
  netModStatus: NetModStatus;
  bytesReceived: number;
  bytesSent: number;
  speedDownloadBps: number;
  speedUploadBps: number;
  activeSockets: number;
  uptimeSeconds: number;
  relayPort: number;
}

export interface ConnectRequestPayload {
  requestedDataPort: number;
  enableUdp: boolean;
  enableDnsProxy: boolean;
  clientTimestamp: number;
}

export interface ConnectResponsePayload {
  success: boolean;
  assignedDataPort: number;
  netModRouted: boolean;
  egressIp?: string;
  errorMessage?: string;
  errorCode?: ErrorCode;
}

export interface DisconnectRequestPayload {
  reason: "USER_REQUESTED" | "DEVICE_UNPLUGGED" | "ERROR_RECOVERY" | "SHUTDOWN";
  message?: string;
}

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

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

// -------------------------------------------------------------
// Unified Envelope
// -------------------------------------------------------------

export interface ControlEnvelope<T = unknown> {
  version: string;
  id: string; // Unique UUID/nanoid for request-response correlation
  type: MessageType;
  timestamp: number; // Unix epoch ms
  payload: T;
}
