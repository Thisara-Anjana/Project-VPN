import React from "react";
import { Shield, Settings, Activity } from "lucide-react";

interface HeaderProps {
  version: string;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({ version, onOpenSettings }) => {
  return (
    <header className="glass-panel" style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)", padding: "8px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Shield size={22} color="#ffffff" />
        </div>
        <div>
          <h1 style={{ fontSize: "18px", fontWeight: "700", letterSpacing: "-0.02em", color: "#f8fafc" }}>
            USB VPN Bridge
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>v{version}</span>
            <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "#64748b" }} />
            <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: "500" }}>Phase 2: Foundation</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(30, 41, 59, 0.6)", padding: "6px 12px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.06)" }}>
          <Activity size={14} color="#10b981" />
          <span style={{ fontSize: "12px", color: "#e2e8f0" }}>Ready for ADB</span>
        </div>

        <button
          onClick={onOpenSettings}
          style={{
            background: "rgba(30, 41, 59, 0.6)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            color: "#94a3b8",
            padding: "8px",
            borderRadius: "8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s ease",
          }}
          title="Settings"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
};
