import React from "react";
import { Power, Info, Activity, AlertCircle, Globe, CheckCircle2, RotateCcw } from "lucide-react";
import { ConnectionState, ProxyDiagnosticResult } from "../types.js";

interface ConnectionControlProps {
  connectionState: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
  onRestoreNetwork: () => void;
  isRestoring: boolean;
  latencyMs: number;
  lastHeartbeatTime: number;
  errorMessage: string | null;
  hasDevice: boolean;
  proxyEgressIp: string | null;
  tunEgressIp: string | null;
  onTestProxy: () => void;
  isTestingProxy: boolean;
  proxyTestResult: ProxyDiagnosticResult | null;
}

export const ConnectionControl: React.FC<ConnectionControlProps> = ({
  connectionState,
  onConnect,
  onDisconnect,
  onRestoreNetwork,
  isRestoring,
  latencyMs,
  lastHeartbeatTime,
  errorMessage,
  hasDevice,
  proxyEgressIp,
  tunEgressIp,
  onTestProxy,
  isTestingProxy,
  proxyTestResult,
}) => {
  const isConnected = connectionState === "INTERNET_CONNECTED";
  const isConnecting = [
    "DEVICE_DETECTED",
    "CONTROL_CONNECTING",
    "CONTROL_CONNECTED",
    "PROXY_CHECKING",
    "PROXY_READY",
    "TUN_STARTING",
    "TUN_ACTIVE",
    "INTERNET_VERIFYING",
  ].includes(connectionState);
  const isDisconnecting = connectionState === "DISCONNECTING" || connectionState === "RECOVERING";

  const getButtonLabel = () => {
    if (isDisconnecting) return "Disconnecting...";
    if (isConnecting) return "Connecting...";
    if (isConnected) return "Disconnect";
    return "Connect";
  };

  const getStatusLabel = () => {
    switch (connectionState) {
      case "INTERNET_CONNECTED":
        return "Full-PC Internet Tethering Active";
      case "CONTROL_CONNECTING":
        return "Connecting USB Control...";
      case "CONTROL_CONNECTED":
        return "USB Control Channel Connected";
      case "PROXY_CHECKING":
        return "Verifying SOCKS5 Relay...";
      case "PROXY_READY":
        return "SOCKS5 Proxy Ready";
      case "TUN_STARTING":
        return "Starting Windows TUN Engine (sing-box)...";
      case "TUN_ACTIVE":
        return "Wintun Adapter Active";
      case "INTERNET_VERIFYING":
        return "Verifying Proxy-Free Internet Route...";
      case "DISCONNECTING":
        return "Restoring Windows Network...";
      case "RECOVERING":
        return "Emergency Route Restoration...";
      case "ERROR":
        return "Connection Error";
      default:
        return hasDevice ? "Ready to Connect" : "Waiting for Android USB Connection";
    }
  };

  return (
    <div className="glass-panel" style={{ padding: "24px 20px", textAlign: "center", marginBottom: "14px" }}>
      <div style={{ display: "inline-block", position: "relative" }}>
        <button
          onClick={isConnected ? onDisconnect : onConnect}
          disabled={!hasDevice || isConnecting || isDisconnecting}
          style={{
            width: "154px",
            height: "154px",
            borderRadius: "50%",
            background: isConnected
              ? "linear-gradient(135deg, #059669, #10b981)"
              : isConnecting
              ? "linear-gradient(135deg, #1e293b, #d97706)"
              : isDisconnecting
              ? "linear-gradient(135deg, #334155, #475569)"
              : "linear-gradient(135deg, #2563eb, #0284c7)",
            border: isConnected
              ? "3px solid rgba(16, 185, 129, 0.5)"
              : isConnecting
              ? "3px solid rgba(245, 158, 11, 0.5)"
              : "3px solid rgba(59, 130, 246, 0.5)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            cursor: !hasDevice || isConnecting || isDisconnecting ? "not-allowed" : "pointer",
            opacity: !hasDevice ? 0.5 : 1,
            boxShadow: isConnected
              ? "0 0 35px rgba(16, 185, 129, 0.4)"
              : isConnecting
              ? "0 0 30px rgba(245, 158, 11, 0.3)"
              : "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
            margin: "0 auto",
            transition: "all 0.3s ease",
          }}
          title={
            !hasDevice
              ? "Please connect an Android phone"
              : isConnected
              ? "Click to disconnect tethering and restore network"
              : "Click to start one-click USB tethering"
          }
        >
          <Power size={40} color="#ffffff" />
          <span
            style={{
              fontSize: "13px",
              fontWeight: "700",
              color: "#ffffff",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {getButtonLabel()}
          </span>
          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.85)", marginTop: "-4px" }}>
            USB VPN Bridge
          </span>
        </button>
      </div>

      {/* Status & Sub-state Info */}
      <div
        style={{
          marginTop: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "13px", color: "#64748b" }}>Status:</span>
          <span
            style={{
              fontSize: "13px",
              fontWeight: "600",
              color: isConnected ? "#10b981" : isConnecting ? "#f59e0b" : connectionState === "ERROR" ? "#f43f5e" : "#94a3b8",
              background: "rgba(255,255,255,0.05)",
              padding: "4px 12px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {getStatusLabel()}
          </span>
        </div>

        {isConnected && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Activity size={14} color="#10b981" />
              <span style={{ fontSize: "12px", color: "#e2e8f0", fontFamily: "monospace" }}>
                Latency: {latencyMs}ms {lastHeartbeatTime > 0 ? "(Live)" : ""}
              </span>
            </div>

            {tunEgressIp && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Globe size={14} color="#38bdf8" />
                <span style={{ fontSize: "12px", color: "#38bdf8", fontFamily: "monospace", fontWeight: "600" }}>
                  VPN Exit: {tunEgressIp} {proxyEgressIp === tunEgressIp ? "(Verified)" : ""}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Diagnostic & Recovery Actions Bar */}
      <div
        style={{
          marginTop: "16px",
          paddingTop: "14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={onTestProxy}
          disabled={isTestingProxy}
          style={{
            background: "rgba(56, 189, 248, 0.12)",
            border: "1px solid rgba(56, 189, 248, 0.35)",
            color: "#38bdf8",
            padding: "6px 14px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: "600",
            cursor: isTestingProxy ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 0.2s ease",
          }}
        >
          <Globe size={14} />
          <span>{isTestingProxy ? "Testing..." : "Test SOCKS5 Relay"}</span>
        </button>

        <button
          onClick={onRestoreNetwork}
          disabled={isRestoring}
          style={{
            background: "rgba(244, 63, 94, 0.12)",
            border: "1px solid rgba(244, 63, 94, 0.35)",
            color: "#f43f5e",
            padding: "6px 14px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: "600",
            cursor: isRestoring ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 0.2s ease",
          }}
          title="Emergency restoration of physical routes and virtual adapter reset"
        >
          <RotateCcw size={14} />
          <span>{isRestoring ? "Restoring..." : "Restore Network"}</span>
        </button>

        {proxyTestResult && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 10px",
              borderRadius: "6px",
              background: proxyTestResult.success ? "rgba(16, 185, 129, 0.15)" : "rgba(244, 63, 94, 0.15)",
              border: `1px solid ${proxyTestResult.success ? "rgba(16, 185, 129, 0.3)" : "rgba(244, 63, 94, 0.3)"}`,
              color: proxyTestResult.success ? "#10b981" : "#f43f5e",
              fontSize: "12px",
            }}
          >
            {proxyTestResult.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span>
              {proxyTestResult.success
                ? `Proxy IP: ${proxyTestResult.egressIp} (${proxyTestResult.latencyMs}ms)`
                : `Failed: ${proxyTestResult.error}`}
            </span>
          </div>
        )}
      </div>

      {errorMessage && (
        <div
          style={{
            marginTop: "12px",
            background: "rgba(244, 63, 94, 0.1)",
            border: "1px solid rgba(244, 63, 94, 0.3)",
            padding: "8px 14px",
            borderRadius: "8px",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            color: "#f43f5e",
            fontSize: "12px",
          }}
        >
          <AlertCircle size={15} />
          <span>{errorMessage}</span>
        </div>
      )}

      <div
        style={{
          marginTop: "12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          fontSize: "12px",
          color: "#64748b",
        }}
      >
        <Info size={14} />
        <span>One-Click USB Tethering: Shares Android internet & NetMod VPN with entire Windows PC via Wintun TUN.</span>
      </div>
    </div>
  );
};
