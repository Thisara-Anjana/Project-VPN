import { contextBridge, ipcRenderer } from "electron";
import { AdbDevice } from "./adbManager.js";
import { ControlSessionInfo } from "./controlClient.js";
import { OrchestratorStatus, ConnectionState } from "./orchestrator.js";

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

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
  listDevices: (): Promise<AdbDevice[]> => ipcRenderer.invoke("adb:list-devices"),

  // Phase 6 Orchestrator APIs
  connect: (serial?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("orchestrator:connect", serial),
  disconnect: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke("orchestrator:disconnect"),
  restoreNetwork: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke("orchestrator:restore"),
  getOrchestratorStatus: (): Promise<OrchestratorStatus> =>
    ipcRenderer.invoke("orchestrator:get-status"),

  // Legacy & Diagnostic APIs
  connectControl: (serial: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("orchestrator:connect", serial),
  disconnectControl: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("orchestrator:disconnect"),
  getControlState: (): Promise<ControlSessionInfo> => ipcRenderer.invoke("control:get-state"),
  testProxyConnection: (): Promise<{ success: boolean; egressIp?: string; latencyMs?: number; error?: string }> =>
    ipcRenderer.invoke("proxy:test-connection"),
  getLogs: (): Promise<LogEntry[]> => ipcRenderer.invoke("logs:get"),
  getRoutingStatus: (): Promise<SystemRoutingStatus> => ipcRenderer.invoke("network:get-routing-status"),
  getNetworkInspection: (): Promise<NetworkInspectionSummary> => ipcRenderer.invoke("network:get-inspection"),

  // Listeners
  onOrchestratorStatusChange: (callback: (status: OrchestratorStatus) => void): (() => void) => {
    const subscription = (_: unknown, status: OrchestratorStatus) => callback(status);
    ipcRenderer.on("orchestrator:status-change", subscription);
    return () => {
      ipcRenderer.removeListener("orchestrator:status-change", subscription);
    };
  },

  onControlStateChange: (callback: (state: ControlSessionInfo) => void): (() => void) => {
    const subscription = (_: unknown, state: ControlSessionInfo) => callback(state);
    ipcRenderer.on("control:state-change", subscription);
    return () => {
      ipcRenderer.removeListener("control:state-change", subscription);
    };
  },

  onRoutingStatusChange: (callback: (status: SystemRoutingStatus) => void): (() => void) => {
    const subscription = (_: unknown, status: SystemRoutingStatus) => callback(status);
    ipcRenderer.on("network:routing-status-change", subscription);
    return () => {
      ipcRenderer.removeListener("network:routing-status-change", subscription);
    };
  },

  onLogEntry: (callback: (log: LogEntry) => void): (() => void) => {
    const subscription = (_: unknown, log: LogEntry) => callback(log);
    ipcRenderer.on("log:entry", subscription);
    return () => {
      ipcRenderer.removeListener("log:entry", subscription);
    };
  },

  onDevicesChange: (callback: (devices: AdbDevice[]) => void): (() => void) => {
    const subscription = (_: unknown, devices: AdbDevice[]) => callback(devices);
    ipcRenderer.on("adb:devices-changed", subscription);
    return () => {
      ipcRenderer.removeListener("adb:devices-changed", subscription);
    };
  },
};

contextBridge.exposeInMainWorld("usbVpnBridge", api);

export type UsbVpnBridgeApi = typeof api;
export { OrchestratorStatus, ConnectionState };
