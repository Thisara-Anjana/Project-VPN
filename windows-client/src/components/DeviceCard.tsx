import React, { useState, useEffect } from "react";
import { Smartphone, Usb, RefreshCw } from "lucide-react";
import { AdbDevice, DeviceInfoPayload } from "../types.js";

interface DeviceCardProps {
  devices: AdbDevice[];
  selectedSerial: string;
  onSelectSerial: (serial: string) => void;
  onRefreshDevices: () => void;
  isRefreshing: boolean;
  activeDeviceInfo: DeviceInfoPayload | null;
  controlState: string;
  sessionStartTime: number;
  lastHeartbeatTime: number;
  latencyMs: number;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  devices,
  selectedSerial,
  onSelectSerial,
  onRefreshDevices,
  isRefreshing,
  activeDeviceInfo,
  controlState,
  sessionStartTime,
  lastHeartbeatTime,
  latencyMs,
}) => {
  const currentDevice = devices.find((d) => d.serial === selectedSerial) || devices[0];
  const isAuthorized = currentDevice?.state === "device";
  const isConnected = controlState === "CONNECTED_IDLE" || controlState === "TETHERING_ACTIVE";
  const isConnecting = controlState === "HANDSHAKING";

  // Status indicator determination (Sub-phase 4.1)
  let statusColor = "#64748b"; // Gray
  let statusText = "Not Started";

  if (isConnected) {
    statusColor = "#10b981"; // Green
    statusText = "Phone Connected";
  } else if (isConnecting) {
    statusColor = "#f59e0b"; // Amber
    statusText = "Connecting to Phone";
  } else if (controlState === "ERROR_STATE" || (!currentDevice && devices.length === 0)) {
    statusColor = "#f43f5e"; // Red
    statusText = "Phone Disconnected";
  } else if (controlState === "DISCONNECTED") {
    statusColor = "#64748b"; // Gray
    statusText = "Not Started";
  }

  // Live timer for connection duration & heartbeat
  const [durationText, setDurationText] = useState("00:00");
  const [heartbeatText, setHeartbeatText] = useState("Inactive");

  useEffect(() => {
    const updateTimers = () => {
      const now = Date.now();
      if (isConnected && sessionStartTime > 0) {
        const secTotal = Math.floor((now - sessionStartTime) / 1000);
        const min = Math.floor(secTotal / 60);
        const sec = secTotal % 60;
        setDurationText(`${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`);
      } else {
        setDurationText("00:00");
      }

      if (isConnected && lastHeartbeatTime > 0) {
        const hbSec = Math.floor((now - lastHeartbeatTime) / 1000);
        if (hbSec <= 1) {
          setHeartbeatText(`Just now (${latencyMs}ms RTT)`);
        } else {
          setHeartbeatText(`${hbSec}s ago (${latencyMs}ms RTT)`);
        }
      } else if (isConnecting) {
        setHeartbeatText("Handshaking...");
      } else {
        setHeartbeatText("Inactive");
      }
    };

    updateTimers();
    const interval = setInterval(updateTimers, 1000);
    return () => clearInterval(interval);
  }, [isConnected, isConnecting, sessionStartTime, lastHeartbeatTime, latencyMs]);

  const deviceName = activeDeviceInfo
    ? `${activeDeviceInfo.manufacturer} ${activeDeviceInfo.model}`
    : currentDevice?.model
    ? `${currentDevice.product || ""} ${currentDevice.model}`.trim()
    : "No Device Detected";

  const authState = currentDevice
    ? isAuthorized
      ? "Authorized (USB Debugging)"
      : `Unauthorized (${currentDevice.state})`
    : "Disconnected";

  return (
    <div className="glass-panel" style={{ padding: "16px", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Smartphone size={18} color="#38bdf8" />
          <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#f1f5f9" }}>Android Phone Connection</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={onRefreshDevices}
            disabled={isRefreshing}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: isRefreshing ? "not-allowed" : "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
            }}
            title="Scan for USB devices"
          >
            <RefreshCw size={14} className={isRefreshing ? "spin" : ""} />
          </button>

          {/* Status Indicator: Colored Dot + Text */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(255, 255, 255, 0.05)",
              padding: "4px 10px",
              borderRadius: "12px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <span
              style={{
                width: "9px",
                height: "9px",
                borderRadius: "50%",
                backgroundColor: statusColor,
                boxShadow: isConnected ? `0 0 8px ${statusColor}` : "none",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontSize: "12px",
                color: statusColor,
                fontWeight: "600",
              }}
            >
              {statusText}
            </span>
          </div>
        </div>
      </div>

      {devices.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {devices.length > 1 && (
            <div style={{ marginBottom: "2px" }}>
              <select
                value={selectedSerial}
                onChange={(e) => onSelectSerial(e.target.value)}
                disabled={isConnected}
                style={{
                  width: "100%",
                  background: "rgba(15, 23, 42, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#f8fafc",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                {devices.map((d) => (
                  <option key={d.serial} value={d.serial}>
                    {d.model ? `${d.model} (${d.serial})` : d.serial} - [{d.state}]
                  </option>
                ))}
              </select>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
              fontSize: "12px",
              background: "rgba(15, 23, 42, 0.6)",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div>
              <span style={{ color: "#64748b" }}>Detected Device:</span>{" "}
              <span style={{ color: "#f8fafc", fontWeight: "600" }}>{deviceName}</span>
            </div>
            <div>
              <span style={{ color: "#64748b" }}>USB Authorization:</span>{" "}
              <span style={{ color: isAuthorized ? "#38bdf8" : "#f59e0b", fontWeight: "500" }}>
                {authState}
              </span>
            </div>
            <div>
              <span style={{ color: "#64748b" }}>Connection Duration:</span>{" "}
              <span style={{ color: isConnected ? "#10b981" : "#94a3b8", fontFamily: "monospace", fontWeight: "600" }}>
                {durationText}
              </span>
            </div>
            <div>
              <span style={{ color: "#64748b" }}>Last Heartbeat:</span>{" "}
              <span style={{ color: "#cbd5e1", fontSize: "11px" }}>{heartbeatText}</span>
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "rgba(15, 23, 42, 0.6)",
            borderRadius: "8px",
            padding: "12px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            border: "1px dashed rgba(255,255,255,0.08)",
          }}
        >
          <Usb size={18} color="#64748b" />
          <div style={{ fontSize: "12px", color: "#94a3b8" }}>
            <span>No Android phone detected over USB.</span>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
              Connect device via USB and enable USB Debugging.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
