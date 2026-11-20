import React from "react";
import { Network, CheckCircle2, AlertTriangle } from "lucide-react";
import { DeviceInfoPayload } from "../types.js";

interface NetModCardProps {
  deviceInfo: DeviceInfoPayload | null;
  isConnected: boolean;
}

export const NetModCard: React.FC<NetModCardProps> = ({ deviceInfo, isConnected }) => {
  const isInstalled = deviceInfo?.netModInstalled ?? false;
  const isVpnActive = deviceInfo?.vpnActive ?? false;

  return (
    <div className="glass-panel" style={{ padding: "16px", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Network size={18} color={isVpnActive ? "#10b981" : "#a855f7"} />
          <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#f1f5f9" }}>NetMod VPN Status</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              fontSize: "12px",
              color: isConnected
                ? isVpnActive
                  ? "#10b981"
                  : isInstalled
                  ? "#f59e0b"
                  : "#f43f5e"
                : "#64748b",
              fontWeight: "600",
            }}
          >
            {isConnected
              ? isVpnActive
                ? "Active VPN (tun0)"
                : isInstalled
                ? "Installed (VPN Idle)"
                : "Not Installed"
              : "Not Verified"}
          </span>
        </div>
      </div>

      <div
        style={{
          background: "rgba(15, 23, 42, 0.6)",
          borderRadius: "8px",
          padding: "12px",
          border: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
        }}
      >
        {isConnected && isVpnActive ? (
          <CheckCircle2 size={18} color="#10b981" style={{ flexShrink: 0, marginTop: "2px" }} />
        ) : isConnected && isInstalled ? (
          <CheckCircle2 size={18} color="#a855f7" style={{ flexShrink: 0, marginTop: "2px" }} />
        ) : (
          <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: "2px" }} />
        )}
        <div style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: "1.4" }}>
          <div style={{ fontWeight: "600", color: "#f8fafc", marginBottom: "2px" }}>
            {isConnected && isVpnActive
              ? "VPN Active & Protecting Traffic"
              : isConnected && isInstalled
              ? "NetMod Installed (VPN Disconnected)"
              : "Awaiting Connection"}
          </div>
          <span>
            {isConnected && isVpnActive
              ? "NetMod VPN is actively managing tun0. Outbound SOCKS5 proxy sockets on Android automatically exit through NetMod's encrypted tunnel."
              : isConnected && isInstalled
              ? "NetMod package com.netmod.syna is installed on the phone. Connect NetMod on Android to route traffic through VPN."
              : "Connect the USB control channel to verify NetMod status and Android network capabilities."}
          </span>
        </div>
      </div>
    </div>
  );
};
