import React from "react";
import { ArrowDown, ArrowUp, HardDriveDownload, HardDriveUpload, Clock } from "lucide-react";

interface StatsGridProps {
  speedDownloadBps: number;
  speedUploadBps: number;
  bytesReceived: number;
  bytesSent: number;
  durationSec?: number;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return "0.00 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0 || isNaN(bytesPerSec)) return "0.00 KB/s";
  const kbps = bytesPerSec / 1024;
  if (kbps < 1024) return `${kbps.toFixed(2)} KB/s`;
  return `${(kbps / 1024).toFixed(2)} MB/s`;
}

function formatDuration(sec: number): string {
  if (sec <= 0) return "00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const StatsGrid: React.FC<StatsGridProps> = ({
  speedDownloadBps,
  speedUploadBps,
  bytesReceived,
  bytesSent,
  durationSec = 0,
}) => {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px", marginBottom: "14px" }}>
      <div className="glass-panel" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#38bdf8", marginBottom: "4px" }}>
          <ArrowDown size={15} />
          <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Download Speed
          </span>
        </div>
        <div style={{ fontSize: "17px", fontWeight: "700", color: "#f8fafc", fontFamily: "monospace" }}>
          {formatSpeed(speedDownloadBps)}
        </div>
        <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>Realtime Throughput</div>
      </div>

      <div className="glass-panel" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#10b981", marginBottom: "4px" }}>
          <ArrowUp size={15} />
          <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Upload Speed
          </span>
        </div>
        <div style={{ fontSize: "17px", fontWeight: "700", color: "#f8fafc", fontFamily: "monospace" }}>
          {formatSpeed(speedUploadBps)}
        </div>
        <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>Realtime Throughput</div>
      </div>

      <div className="glass-panel" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#a855f7", marginBottom: "4px" }}>
          <HardDriveDownload size={15} />
          <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Total Downloaded
          </span>
        </div>
        <div style={{ fontSize: "17px", fontWeight: "700", color: "#f8fafc", fontFamily: "monospace" }}>
          {formatBytes(bytesReceived)}
        </div>
        <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>Session Total</div>
      </div>

      <div className="glass-panel" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#f59e0b", marginBottom: "4px" }}>
          <HardDriveUpload size={15} />
          <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Total Uploaded
          </span>
        </div>
        <div style={{ fontSize: "17px", fontWeight: "700", color: "#f8fafc", fontFamily: "monospace" }}>
          {formatBytes(bytesSent)}
        </div>
        <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>Session Total</div>
      </div>

      <div className="glass-panel" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#38bdf8", marginBottom: "4px" }}>
          <Clock size={15} />
          <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Duration
          </span>
        </div>
        <div style={{ fontSize: "17px", fontWeight: "700", color: "#f8fafc", fontFamily: "monospace" }}>
          {formatDuration(durationSec)}
        </div>
        <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>Active Connection</div>
      </div>
    </div>
  );
};
