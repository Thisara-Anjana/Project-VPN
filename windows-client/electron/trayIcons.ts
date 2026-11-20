import { nativeImage, NativeImage, app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { ConnectionState } from "./orchestrator.js";

// Embedded base64 buffers as guaranteed fallbacks
const isAppPackaged = typeof app !== "undefined" && app?.isPackaged;
const ASSETS_DIR = isAppPackaged
  ? path.join(process.resourcesPath || "", "assets")
  : path.resolve(__dirname, "../../assets");

function loadIcon(filename: string): NativeImage {
  if (typeof nativeImage === "undefined" || !nativeImage) {
    return {} as NativeImage;
  }
  const candidatePaths = [
    path.join(ASSETS_DIR, filename),
    path.resolve(process.cwd(), "assets", filename),
    path.resolve(process.cwd(), "windows-client/assets", filename),
    path.resolve(__dirname, "../assets", filename),
    path.resolve(__dirname, "../../assets", filename),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p);
        if (img && !img.isEmpty()) {
          return img;
        }
      } catch {}
    }
  }

  // Fallback: create empty 16x16 icon
  return nativeImage ? nativeImage.createEmpty() : ({} as NativeImage);
}

let cachedIcons: {
  disconnected: NativeImage | null;
  connected: NativeImage | null;
  connecting: NativeImage | null;
  error: NativeImage | null;
} = {
  disconnected: null,
  connected: null,
  connecting: null,
  error: null,
};

export function getTrayIcon(state: ConnectionState): NativeImage {
  if (!cachedIcons.disconnected) {
    cachedIcons.disconnected = loadIcon("tray-disconnected.png");
    cachedIcons.connected = loadIcon("tray-connected.png");
    cachedIcons.connecting = loadIcon("tray-connecting.png");
    cachedIcons.error = loadIcon("tray-error.png");
  }

  switch (state) {
    case "INTERNET_CONNECTED":
      return cachedIcons.connected || nativeImage.createEmpty();

    case "CONTROL_CONNECTING":
    case "CONTROL_CONNECTED":
    case "PROXY_CHECKING":
    case "PROXY_READY":
    case "TUN_STARTING":
    case "TUN_ACTIVE":
    case "INTERNET_VERIFYING":
    case "DISCONNECTING":
    case "RECOVERING":
      return cachedIcons.connecting || nativeImage.createEmpty();

    case "ERROR":
      return cachedIcons.error || nativeImage.createEmpty();

    case "DISCONNECTED":
    case "DEVICE_DETECTED":
    default:
      return cachedIcons.disconnected || nativeImage.createEmpty();
  }
}

export function getStatusTooltip(state: ConnectionState): string {
  switch (state) {
    case "INTERNET_CONNECTED":
      return "USB VPN Bridge — Connected (Android VPN Active)";
    case "DEVICE_DETECTED":
      return "USB VPN Bridge — Android Phone Ready";
    case "CONTROL_CONNECTING":
    case "CONTROL_CONNECTED":
      return "USB VPN Bridge — Connecting USB Control...";
    case "PROXY_CHECKING":
    case "PROXY_READY":
      return "USB VPN Bridge — Verifying SOCKS5 Relay...";
    case "TUN_STARTING":
    case "TUN_ACTIVE":
      return "USB VPN Bridge — Starting Windows Tunnel...";
    case "INTERNET_VERIFYING":
      return "USB VPN Bridge — Verifying Internet Route...";
    case "DISCONNECTING":
      return "USB VPN Bridge — Disconnecting...";
    case "RECOVERING":
      return "USB VPN Bridge — Reconnecting USB Link...";
    case "ERROR":
      return "USB VPN Bridge — Connection Error";
    case "DISCONNECTED":
    default:
      return "USB VPN Bridge — Disconnected";
  }
}

export function getStatusMenuLabel(state: ConnectionState): string {
  switch (state) {
    case "INTERNET_CONNECTED":
      return "Connected (VPN Shared)";
    case "DEVICE_DETECTED":
      return "Phone Ready to Connect";
    case "CONTROL_CONNECTING":
    case "CONTROL_CONNECTED":
      return "Connecting Control...";
    case "PROXY_CHECKING":
    case "PROXY_READY":
      return "Checking SOCKS5 Proxy...";
    case "TUN_STARTING":
    case "TUN_ACTIVE":
      return "Starting TUN Engine...";
    case "INTERNET_VERIFYING":
      return "Verifying Internet...";
    case "DISCONNECTING":
      return "Disconnecting...";
    case "RECOVERING":
      return "Reconnecting...";
    case "ERROR":
      return "Error";
    case "DISCONNECTED":
    default:
      return "Disconnected";
  }
}
