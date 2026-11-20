import React, { useState, useEffect, useCallback } from "react";
import { Header } from "./components/Header.js";
import { DeviceCard } from "./components/DeviceCard.js";
import { NetModCard } from "./components/NetModCard.js";
import { ConnectionControl } from "./components/ConnectionControl.js";
import { NetworkStatusRow } from "./components/NetworkStatusRow.js";
import { StatsGrid } from "./components/StatsGrid.js";
import { LogViewer } from "./components/LogViewer.js";
import { SettingsModal } from "./components/SettingsModal.js";
import {
  AdbDevice,
  ControlSessionInfo,
  LogEntry,
  ProxyDiagnosticResult,
  SystemRoutingStatus,
  OrchestratorStatus,
} from "./types.js";

export const App: React.FC = () => {
  const [version, setVersion] = useState("1.0.0");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [devices, setDevices] = useState<AdbDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<ProxyDiagnosticResult | null>(null);

  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus>({
    state: "DISCONNECTED",
    serial: null,
    deviceModel: null,
    vpnAppName: "Unknown",
    isVpnActive: false,
    tunnelAdapterActive: false,
    proxyEgressIp: null,
    tunEgressIp: null,
    lastError: null,
    sessionDurationSec: 0,
    sessionStartTime: 0,
    downloadSpeedBps: 0,
    uploadSpeedBps: 0,
    totalBytesReceived: 0,
    totalBytesSent: 0,
    activeSockets: 0,
    latencyMs: 0,
  });

  const [controlState, setControlState] = useState<ControlSessionInfo>({
    state: "DISCONNECTED",
    deviceInfo: null,
    latencyMs: 0,
    sessionId: null,
    lastHeartbeatTime: 0,
    errorMessage: null,
    activeSockets: 0,
    speedDownloadBps: 0,
    speedUploadBps: 0,
    bytesReceived: 0,
    bytesSent: 0,
  });

  const [routingStatus, setRoutingStatus] = useState<SystemRoutingStatus>({
    usbControl: "Disconnected",
    androidProxy: "Unavailable",
    windowsTunnel: "Not Started",
    internetSharing: "Not Verified",
    vpnRouting: "Unknown",
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);

  const refreshDevices = useCallback(async () => {
    if (!window.usbVpnBridge) return;
    setIsRefreshing(true);
    try {
      const devList = await window.usbVpnBridge.listDevices();
      setDevices(devList);
      if (devList.length > 0 && (!selectedSerial || !devList.some((d) => d.serial === selectedSerial))) {
        const authorized = devList.find((d) => d.state === "device");
        setSelectedSerial(authorized ? authorized.serial : devList[0].serial);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedSerial]);

  useEffect(() => {
    if (!window.usbVpnBridge) return;

    window.usbVpnBridge.getVersion().then((v) => setVersion(v));
    window.usbVpnBridge.getLogs().then((l) => setLogs(l));
    window.usbVpnBridge.getControlState().then((s) => setControlState(s));
    if (window.usbVpnBridge.getRoutingStatus) {
      window.usbVpnBridge.getRoutingStatus().then((s) => setRoutingStatus(s));
    }
    if (window.usbVpnBridge.getOrchestratorStatus) {
      window.usbVpnBridge.getOrchestratorStatus().then((s) => setOrchestratorStatus(s));
    }

    refreshDevices();

    // Fast-sync whenever the window is restored or focused
    const handleFocus = () => {
      refreshDevices();
      if (window.usbVpnBridge?.getOrchestratorStatus) {
        window.usbVpnBridge.getOrchestratorStatus().then((s) => setOrchestratorStatus(s));
      }
      if (window.usbVpnBridge?.getRoutingStatus) {
        window.usbVpnBridge.getRoutingStatus().then((s) => setRoutingStatus(s));
      }
    };
    window.addEventListener("focus", handleFocus);

    // Fallback polling (relaxed to 10s since Main process pushes real-time device changes)
    const interval = setInterval(() => {
      refreshDevices();
    }, 10000);

    const unsubDevices = (window.usbVpnBridge as any).onDevicesChange
      ? (window.usbVpnBridge as any).onDevicesChange((devList: AdbDevice[]) => {
          setDevices(devList);
          if (devList.length > 0 && !selectedSerial) {
            const authorized = devList.find((d) => d.state === "device");
            setSelectedSerial(authorized ? authorized.serial : devList[0].serial);
          }
        })
      : () => {};

    const unsubOrch = window.usbVpnBridge.onOrchestratorStatusChange
      ? window.usbVpnBridge.onOrchestratorStatusChange((status) => {
          setOrchestratorStatus(status);
        })
      : () => {};

    const unsubState = window.usbVpnBridge.onControlStateChange((state) => {
      setControlState(state);
    });

    const unsubRouting = window.usbVpnBridge.onRoutingStatusChange
      ? window.usbVpnBridge.onRoutingStatusChange((status) => {
          setRoutingStatus(status);
        })
      : () => {};

    const unsubLog = window.usbVpnBridge.onLogEntry((log) => {
      setLogs((prev) => [...prev, log]);
    });

    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(interval);
      unsubDevices();
      unsubOrch();
      unsubState();
      unsubRouting();
      unsubLog();
    };
  }, [refreshDevices]);

  // One-Click Connect Handler
  const handleConnect = async () => {
    if (!window.usbVpnBridge) return;
    setProxyTestResult(null);
    try {
      await window.usbVpnBridge.connect(selectedSerial);
    } catch {}
  };

  // One-Click Disconnect Handler
  const handleDisconnect = async () => {
    if (!window.usbVpnBridge) return;
    setProxyTestResult(null);
    try {
      await window.usbVpnBridge.disconnect();
    } catch {}
  };

  // Emergency Restore Network Handler
  const handleRestoreNetwork = async () => {
    if (!window.usbVpnBridge) return;
    setIsRestoring(true);
    try {
      await window.usbVpnBridge.restoreNetwork();
    } finally {
      setIsRestoring(false);
    }
  };

  const handleTestProxy = async () => {
    if (!window.usbVpnBridge) return;
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const res = await window.usbVpnBridge.testProxyConnection();
      setProxyTestResult(res);
    } catch (err) {
      setProxyTestResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTestingProxy(false);
    }
  };

  const isConnected = orchestratorStatus.state === "INTERNET_CONNECTED" || controlState.state === "CONNECTED_IDLE";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", padding: "16px", overflow: "hidden" }}>
      <Header version={version} onOpenSettings={() => setIsSettingsOpen(true)} />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px", overflowY: "auto", paddingRight: "4px" }}>
        {/* Device & NetMod Status Row */}
        <div style={{ display: "flex", gap: "12px" }}>
          <DeviceCard
            devices={devices}
            selectedSerial={selectedSerial}
            onSelectSerial={setSelectedSerial}
            onRefreshDevices={refreshDevices}
            isRefreshing={isRefreshing}
            activeDeviceInfo={controlState.deviceInfo}
            controlState={controlState.state}
            sessionStartTime={orchestratorStatus.sessionStartTime || controlState.sessionStartTime || 0}
            lastHeartbeatTime={controlState.lastHeartbeatTime}
            latencyMs={orchestratorStatus.latencyMs || controlState.latencyMs}
          />
          <NetModCard deviceInfo={controlState.deviceInfo} isConnected={isConnected} />
        </div>

        {/* Central One-Click Connection Control */}
        <ConnectionControl
          connectionState={orchestratorStatus.state}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onRestoreNetwork={handleRestoreNetwork}
          isRestoring={isRestoring}
          latencyMs={orchestratorStatus.latencyMs || controlState.latencyMs}
          lastHeartbeatTime={controlState.lastHeartbeatTime}
          errorMessage={orchestratorStatus.lastError || controlState.errorMessage}
          hasDevice={devices.length > 0}
          proxyEgressIp={orchestratorStatus.proxyEgressIp}
          tunEgressIp={orchestratorStatus.tunEgressIp}
          onTestProxy={handleTestProxy}
          isTestingProxy={isTestingProxy}
          proxyTestResult={proxyTestResult}
        />

        {/* Pipeline State Indicators & Restore Action */}
        <NetworkStatusRow routingStatus={routingStatus} />

        {/* Real Network Statistics Grid */}
        <StatsGrid
          speedDownloadBps={orchestratorStatus.downloadSpeedBps || controlState.speedDownloadBps || 0}
          speedUploadBps={orchestratorStatus.uploadSpeedBps || controlState.speedUploadBps || 0}
          bytesReceived={orchestratorStatus.totalBytesReceived || controlState.bytesReceived || 0}
          bytesSent={orchestratorStatus.totalBytesSent || controlState.bytesSent || 0}
          durationSec={orchestratorStatus.sessionDurationSec}
        />

        {/* Realtime Event Log Viewer */}
        <LogViewer logs={logs} onClear={() => setLogs([])} />
      </main>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
};
