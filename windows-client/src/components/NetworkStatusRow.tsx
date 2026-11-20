import React, { useState } from "react";
import { Usb, Server, Shield, Globe, Lock, RefreshCcw } from "lucide-react";
import { SystemRoutingStatus } from "../types.js";

interface NetworkStatusRowProps {
  routingStatus: SystemRoutingStatus;
}

export const NetworkStatusRow: React.FC<NetworkStatusRowProps> = ({ routingStatus }) => {
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  const getBadgeStyle = (isActive: boolean, activeColor: string) => ({
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    borderRadius: "8px",
    background: isActive ? `${activeColor}15` : "rgba(255, 255, 255, 0.03)",
    border: `1px solid ${isActive ? `${activeColor}40` : "rgba(255, 255, 255, 0.06)"}`,
    color: isActive ? activeColor : "#64748b",
    fontSize: "12px",
    fontWeight: "600",
  });

  const handleRestoreNetwork = async () => {
    if (!window.usbVpnBridge?.restoreNetwork) return;
    setIsRestoring(true);
    setRestoreMessage(null);
    try {
      const res = await window.usbVpnBridge.restoreNetwork();
      setRestoreMessage(res.message);
      setTimeout(() => setRestoreMessage(null), 4000);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Pipeline State:
        </span>

        {/* 1. USB Control */}
        <div style={getBadgeStyle(routingStatus.usbControl === "Connected", "#10b981")}>
          <Usb size={14} />
          <span>USB Control: {routingStatus.usbControl}</span>
        </div>

        {/* 2. Android Proxy */}
        <div style={getBadgeStyle(routingStatus.androidProxy === "Ready", "#38bdf8")}>
          <Server size={14} />
          <span>Android Proxy: {routingStatus.androidProxy}</span>
        </div>

        {/* 3. Windows Tunnel */}
        <div style={getBadgeStyle(routingStatus.windowsTunnel === "Active", "#818cf8")}>
          <Shield size={14} />
          <span>Windows Tunnel: {routingStatus.windowsTunnel}</span>
        </div>

        {/* 4. Internet Sharing */}
        <div style={getBadgeStyle(routingStatus.internetSharing === "Verified", "#34d399")}>
          <Globe size={14} />
          <span>Internet: {routingStatus.internetSharing}</span>
        </div>

        {/* 5. VPN Routing */}
        <div style={getBadgeStyle(routingStatus.vpnRouting === "Verified", "#c084fc")}>
          <Lock size={14} />
          <span>VPN Routing: {routingStatus.vpnRouting}</span>
        </div>
      </div>

      {/* Emergency Restore Action */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {restoreMessage && (
          <span style={{ fontSize: "11px", color: "#10b981", fontWeight: "600" }}>
            {restoreMessage}
          </span>
        )}
        <button
          onClick={handleRestoreNetwork}
          disabled={isRestoring}
          style={{
            background: "rgba(244, 63, 94, 0.12)",
            border: "1px solid rgba(244, 63, 94, 0.35)",
            color: "#f43f5e",
            padding: "5px 12px",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: "600",
            cursor: isRestoring ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            transition: "all 0.2s ease",
          }}
          title="Emergency rollback: resets system routing metrics to original snapshot"
        >
          <RefreshCcw size={12} className={isRestoring ? "animate-spin" : ""} />
          <span>{isRestoring ? "Restoring..." : "Restore Network"}</span>
        </button>
      </div>
    </div>
  );
};
