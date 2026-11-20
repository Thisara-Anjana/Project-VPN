export type ConnectionState =
  | "DISCONNECTED"
  | "DEVICE_DETECTED"
  | "CONTROL_CONNECTING"
  | "CONTROL_CONNECTED"
  | "PROXY_CHECKING"
  | "PROXY_READY"
  | "TUN_STARTING"
  | "TUN_ACTIVE"
  | "INTERNET_VERIFYING"
  | "INTERNET_CONNECTED"
  | "DISCONNECTING"
  | "RECOVERING"
  | "ERROR";

export interface OrchestratorStatus {
  state: ConnectionState;
  serial: string | null;
  deviceModel: string | null;
  vpnAppName: string;
  isVpnActive: boolean;
  tunnelAdapterActive: boolean;
  proxyEgressIp: string | null;
  tunEgressIp: string | null;
  lastError: string | null;
  sessionDurationSec: number;
  sessionStartTime: number;
  downloadSpeedBps: number;
  uploadSpeedBps: number;
  totalBytesReceived: number;
  totalBytesSent: number;
  activeSockets: number;
  latencyMs: number;
}

export interface AdbDevice {
  serial: string;
  state: "device" | "unauthorized" | "offline" | "unknown";
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
}

export interface DeviceInfoPayload {
  model: string;
  manufacturer: string;
  osVersion: string;
  apiLevel: number;
  batteryLevel?: number;
  isCharging?: boolean;
  netModInstalled: boolean;
  netModVersion?: string;
  vpnActive?: boolean;
}

export interface ControlSessionInfo {
  state: string;
  deviceInfo: DeviceInfoPayload | null;
  latencyMs: number;
  sessionId: string | null;
  sessionStartTime?: number;
  lastHeartbeatTime: number;
  errorMessage: string | null;
  activeSockets?: number;
  speedDownloadBps?: number;
  speedUploadBps?: number;
  bytesReceived?: number;
  bytesSent?: number;
  dataPort?: number;
}

export interface ProxyDiagnosticResult {
  success: boolean;
  egressIp?: string;
  latencyMs?: number;
  error?: string;
}

export interface LogEntry {
  timestamp: number;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  message: string;
}

export interface SystemRoutingStatus {
  usbControl: "Connected" | "Disconnected";
  androidProxy: "Ready" | "Unavailable";
  windowsTunnel: "Not Started" | "Ready" | "Active" | "Error";
  internetSharing: "Not Verified" | "Verified";
  vpnRouting: "Verified" | "Unknown";
}

export interface NetworkInspectionSummary {
  primaryAdapter: string | null;
  defaultGateway: string | null;
  metric: number | null;
  activeVpnAdapters: string[];
  recoveryScriptReady: boolean;
}

declare global {
  interface Window {
    usbVpnBridge?: {
      getVersion: () => Promise<string>;
      listDevices: () => Promise<AdbDevice[]>;
      connect: (serial?: string) => Promise<{ success: boolean; error?: string }>;
      disconnect: () => Promise<{ success: boolean; message: string }>;
      restoreNetwork: () => Promise<{ success: boolean; message: string }>;
      getOrchestratorStatus: () => Promise<OrchestratorStatus>;
      onOrchestratorStatusChange: (callback: (status: OrchestratorStatus) => void) => () => void;

      // Legacy / diagnostic APIs
      connectControl: (serial: string) => Promise<{ success: boolean; error?: string }>;
      disconnectControl: () => Promise<{ success: boolean }>;
      getControlState: () => Promise<ControlSessionInfo>;
      testProxyConnection: () => Promise<ProxyDiagnosticResult>;
      getLogs: () => Promise<LogEntry[]>;
      getRoutingStatus: () => Promise<SystemRoutingStatus>;
      getNetworkInspection: () => Promise<NetworkInspectionSummary>;
      onControlStateChange: (callback: (state: ControlSessionInfo) => void) => () => void;
      onRoutingStatusChange: (callback: (status: SystemRoutingStatus) => void) => () => void;
      onLogEntry: (callback: (log: LogEntry) => void) => () => void;
      onDevicesChange?: (callback: (devices: AdbDevice[]) => void) => () => void;
    };
  }
}
