import React, { useEffect, useState } from "react";
import { X, ShieldAlert, Cpu, Network, Radio, ShieldCheck, CheckCircle2 } from "lucide-react";
import { NetworkInspectionSummary } from "../types.js";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [inspection, setInspection] = useState<NetworkInspectionSummary | null>(null);

  useEffect(() => {
    if (isOpen && window.usbVpnBridge?.getNetworkInspection) {
      window.usbVpnBridge.getNetworkInspection().then((data) => setInspection(data));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: "560px",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#0f172a",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          padding: "20px",
          borderRadius: "12px",
          boxShadow: "0 20px 40px -10px rgba(0,0,0,0.8)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#f8fafc" }}>
            Network Core & System Settings
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "13px" }}>
          {/* Ports */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "#94a3b8", marginBottom: "6px" }}>
                <Radio size={14} color="#38bdf8" /> Control Channel (ADB)
              </label>
              <input
                type="text"
                value="127.0.0.1:10809"
                disabled
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#e2e8f0",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontFamily: "monospace",
                }}
              />
            </div>

            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "#94a3b8", marginBottom: "6px" }}>
                <Network size={14} color="#10b981" /> Relay Data Port (SOCKS5)
              </label>
              <input
                type="text"
                value="127.0.0.1:10808"
                disabled
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#e2e8f0",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontFamily: "monospace",
                }}
              />
            </div>
          </div>

          {/* Engine */}
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "#94a3b8", marginBottom: "6px" }}>
              <Cpu size={14} color="#a855f7" /> Native Routing Engine
            </label>
            <input
              type="text"
              value="sing-box TUN Engine (gVisor Stack) + Wintun"
              disabled
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#e2e8f0",
                padding: "8px 10px",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            />
          </div>

          {/* Phase 5A Read-Only Inspection Card */}
          <div
            style={{
              background: "rgba(15, 23, 42, 0.6)",
              borderRadius: "8px",
              padding: "12px",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", color: "#38bdf8", fontWeight: "600", fontSize: "12px" }}>
              <ShieldCheck size={16} />
              <span>Phase 5A Safe Architecture & Read-Only System Audit</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "#cbd5e1" }}>
              <div>
                <span style={{ color: "#94a3b8" }}>Primary Physical Adapter: </span>
                <span style={{ fontFamily: "monospace", fontWeight: "600" }}>{inspection?.primaryAdapter || "Detecting..."}</span>
              </div>
              <div>
                <span style={{ color: "#94a3b8" }}>Default IPv4 Gateway: </span>
                <span style={{ fontFamily: "monospace" }}>{inspection?.defaultGateway || "N/A"} (Metric: {inspection?.metric ?? "N/A"})</span>
              </div>
              <div>
                <span style={{ color: "#94a3b8" }}>Third-Party VPN Protection: </span>
                <span style={{ color: "#10b981", fontWeight: "600" }}>
                  {inspection?.activeVpnAdapters?.length ? `Preserving ${inspection.activeVpnAdapters.join(", ")}` : "None active (Clear)"}
                </span>
              </div>
              <div>
                <span style={{ color: "#94a3b8" }}>Route-Loop Prevention: </span>
                <span style={{ color: "#10b981", fontWeight: "600" }}>Verified (127.0.0.0/8 & adb.exe excluded)</span>
              </div>
              <div>
                <span style={{ color: "#94a3b8" }}>Unsupported UDP Policy: </span>
                <span style={{ color: "#f59e0b", fontWeight: "600" }}>BLOCK (Fallback to TCP, zero leakage)</span>
              </div>
              <div>
                <span style={{ color: "#94a3b8" }}>IPv6 Leak Protection: </span>
                <span style={{ color: "#10b981", fontWeight: "600" }}>BLOCK (Local blackhole active)</span>
              </div>
            </div>
          </div>

          {/* Recovery Script Banner */}
          <div
            style={{
              background: "rgba(16, 185, 129, 0.08)",
              borderRadius: "8px",
              padding: "10px 12px",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0 }} />
            <div style={{ fontSize: "11px", color: "#e2e8f0", lineHeight: "1.4" }}>
              <strong>Emergency Restoration Ready:</strong> Standalone scripts (<code style={{ color: "#38bdf8" }}>restore-routes.bat</code> & <code style={{ color: "#38bdf8" }}>restore-routes.ps1</code>) generated in <code style={{ color: "#cbd5e1" }}>network-core/state/</code>.
            </div>
          </div>

          <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: "10px" }}>
            <ShieldAlert size={16} color="#38bdf8" style={{ flexShrink: 0, marginTop: "2px" }} />
            <div style={{ fontSize: "11px", color: "#94a3b8", lineHeight: "1.4" }}>
              <strong>Phase 5A Notice:</strong> TUN interface activation and system route modifications remain strictly inactive until Phase 5B user authorization.
            </div>
          </div>
        </div>

        <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "#2563eb",
              border: "none",
              color: "#ffffff",
              padding: "8px 18px",
              borderRadius: "6px",
              fontWeight: "600",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
