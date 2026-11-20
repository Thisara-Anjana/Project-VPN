import React from "react";
import { Terminal, Trash2 } from "lucide-react";
import { LogEntry } from "../types.js";

interface LogViewerProps {
  logs: LogEntry[];
  onClear: () => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, onClear }) => {
  return (
    <div className="glass-panel" style={{ padding: "14px", flex: 1, display: "flex", flexDirection: "column", minHeight: "160px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Terminal size={15} color="#94a3b8" />
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#e2e8f0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Event Log
          </span>
        </div>
        <button
          onClick={onClear}
          style={{
            background: "transparent",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
            padding: "2px 6px",
            borderRadius: "4px",
          }}
          title="Clear Logs"
        >
          <Trash2 size={13} />
          <span>Clear</span>
        </button>
      </div>

      <div
        style={{
          flex: 1,
          background: "rgba(10, 15, 29, 0.8)",
          borderRadius: "6px",
          padding: "8px 12px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "11px",
          overflowY: "auto",
          maxHeight: "150px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          border: "1px solid rgba(255, 255, 255, 0.04)",
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: "#475569", fontStyle: "italic" }}>No log entries recorded.</div>
        ) : (
          logs.map((log, index) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString();
            let color = "#94a3b8";
            if (log.level === "WARN") color = "#f59e0b";
            if (log.level === "ERROR") color = "#f43f5e";
            if (log.level === "INFO") color = "#38bdf8";

            return (
              <div key={index} style={{ lineHeight: "1.4" }}>
                <span style={{ color: "#475569", marginRight: "8px" }}>[{timeStr}]</span>
                <span style={{ color, fontWeight: "600", marginRight: "8px" }}>[{log.level}]</span>
                <span style={{ color: "#cbd5e1" }}>{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
