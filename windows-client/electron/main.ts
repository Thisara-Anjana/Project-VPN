import { app, BrowserWindow, ipcMain, powerSaveBlocker, Tray, Menu, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { AdbManager, AdbDevice } from "./adbManager.js";
import { ControlClient, ControlSessionInfo } from "./controlClient.js";
import {
  EngineLauncher,
  NetworkInspector,
  RouteRestorer,
  NetworkStateSnapshot,
} from "@usb-vpn-bridge/network-core";
import {
  ConnectionOrchestrator,
  OrchestratorStatus,
  ConnectionState,
} from "./orchestrator.js";
import {
  getTrayIcon,
  getStatusTooltip,
  getStatusMenuLabel,
} from "./trayIcons.js";

// Single-Instance Lock: Prevent duplicate processes and duplicate tray icons
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

const isPackaged = app.isPackaged;
const stateDir = isPackaged
  ? path.join(app.getPath("userData"), "state")
  : (fs.existsSync(path.resolve(process.cwd(), "network-core/state"))
      ? path.resolve(process.cwd(), "network-core/state")
      : path.join(app.getPath("userData"), "state"));

if (!fs.existsSync(stateDir)) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch {}
}

process.on("uncaughtException", (err) => {
  try {
    fs.appendFileSync(path.join(stateDir, "main-error.log"), `[UNCAUGHT] ${err.stack || err}\n`);
  } catch {}
});

process.on("unhandledRejection", (reason) => {
  try {
    fs.appendFileSync(path.join(stateDir, "main-error.log"), `[REJECTION] ${reason}\n`);
  } catch {}
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const adbManager = new AdbManager();
const controlClient = new ControlClient();
const engineLauncher = new EngineLauncher(isPackaged ? undefined : path.resolve(process.cwd(), "network-core"), stateDir);
const orchestrator = new ConnectionOrchestrator(adbManager, controlClient, engineLauncher, stateDir);

let networkSnapshot: NetworkStateSnapshot | null = null;

export interface LogEntry {
  timestamp: number;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  message: string;
}

export interface SystemRoutingStatus {
  usbControl: "Connected" | "Disconnected";
  androidProxy: "Ready" | "Unavailable";
  windowsTunnel: "Not Started" | "Ready" | "Active" | "Error";
  internetSharing: "Not Verified" | "Verified";
  vpnRouting: "Verified" | "Unknown";
}

const memoryLogs: LogEntry[] = [];

function addLog(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string) {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    message,
  };
  memoryLogs.push(entry);
  if (memoryLogs.length > 500) {
    memoryLogs.shift();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log:entry", entry);
  }
}

function computeRoutingStatus(): SystemRoutingStatus {
  const status = orchestrator.getStatus();
  const session = controlClient.getSessionInfo();
  const isUsbConnected = session.state === "CONNECTED_IDLE";
  const isProxyReady =
    isUsbConnected &&
    status.proxyEgressIp !== null &&
    status.state !== "DISCONNECTED" &&
    status.state !== "ERROR" &&
    status.state !== "RECOVERING";
  const engineStatus = engineLauncher.getStatus();

  let tunnelStatus: SystemRoutingStatus["windowsTunnel"] = "Not Started";
  if (status.state === "TUN_STARTING" || engineStatus === "READY") {
    tunnelStatus = "Ready";
  } else if (
    status.state === "TUN_ACTIVE" ||
    status.state === "INTERNET_VERIFYING" ||
    status.state === "INTERNET_CONNECTED" ||
    engineStatus === "ACTIVE"
  ) {
    tunnelStatus = "Active";
  } else if (status.state === "ERROR" || engineStatus === "ERROR") {
    tunnelStatus = "Error";
  }

  const isInternetVerified = status.state === "INTERNET_CONNECTED";
  const isVpnVerified = isInternetVerified && status.isVpnActive;

  return {
    usbControl: isUsbConnected ? "Connected" : "Disconnected",
    androidProxy: isProxyReady ? "Ready" : "Unavailable",
    windowsTunnel: tunnelStatus,
    internetSharing: isInternetVerified ? "Verified" : "Not Verified",
    vpnRouting: isVpnVerified ? "Verified" : "Unknown",
  };
}

function broadcastRoutingStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("network:routing-status-change", computeRoutingStatus());
  }
}

let powerSaveBlockerId: number | null = null;

function syncPowerSaveBlocker(state: ConnectionState) {
  const isTunnelActive =
    state === "CONTROL_CONNECTED" ||
    state === "PROXY_CHECKING" ||
    state === "PROXY_READY" ||
    state === "TUN_STARTING" ||
    state === "TUN_ACTIVE" ||
    state === "INTERNET_VERIFYING" ||
    state === "INTERNET_CONNECTED";

  if (isTunnelActive && powerSaveBlockerId === null) {
    try {
      powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
      addLog("INFO", `[POWER] Activated powerSaveBlocker (id: ${powerSaveBlockerId}) to maintain background USB VPN tethering`);
    } catch {}
  } else if (!isTunnelActive && powerSaveBlockerId !== null) {
    try {
      if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlocker.stop(powerSaveBlockerId);
        addLog("INFO", `[POWER] Released powerSaveBlocker (id: ${powerSaveBlockerId})`);
      }
    } catch {}
    powerSaveBlockerId = null;
  }
}

function syncRendererState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("orchestrator:status-change", orchestrator.getStatus());
    mainWindow.webContents.send("control:state-change", controlClient.getSessionInfo());
    broadcastRoutingStatus();
  }
}

export function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  syncRendererState();
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const status = orchestrator.getStatus();
  const state = status.state;
  const isConnected = state === "INTERNET_CONNECTED";
  const isTransitioning = [
    "CONTROL_CONNECTING",
    "PROXY_CHECKING",
    "TUN_STARTING",
    "INTERNET_VERIFYING",
    "DISCONNECTING",
    "RECOVERING",
  ].includes(state);

  const statusMenuLabel = getStatusMenuLabel(state);
  const icon = getTrayIcon(state);
  const tooltip = getStatusTooltip(state);

  try {
    tray.setImage(icon);
    tray.setToolTip(tooltip);
  } catch {}

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open USB VPN Bridge",
      click: () => {
        restoreMainWindow();
      },
    },
    { type: "separator" },
    {
      label: `Status: ${statusMenuLabel}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Connect",
      enabled: !isConnected && !isTransitioning,
      click: async () => {
        addLog("INFO", "[TRAY] Connect requested from system tray menu.");
        try {
          await orchestrator.connect();
        } catch (err) {
          addLog("ERROR", `[TRAY] Connect failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
    {
      label: "Disconnect",
      enabled: isConnected || isTransitioning,
      click: async () => {
        addLog("INFO", "[TRAY] Disconnect requested from system tray menu.");
        try {
          await orchestrator.disconnect();
        } catch (err) {
          addLog("ERROR", `[TRAY] Disconnect failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
    { type: "separator" },
    {
      label: "Exit",
      click: async () => {
        await handleApplicationExit();
      },
    },
  ]);

  try {
    tray.setContextMenu(contextMenu);
  } catch {}

  exportTrayStatus();
}

function exportTrayStatus() {
  try {
    const status = orchestrator.getStatus();
    const info = {
      trayCreated: !!tray && !tray.isDestroyed(),
      tooltip: getStatusTooltip(status.state),
      state: status.state,
      menuStatusLabel: getStatusMenuLabel(status.state),
      isWindowVisible: mainWindow ? mainWindow.isVisible() : false,
      isWindowMinimized: mainWindow ? mainWindow.isMinimized() : false,
    };
    fs.writeFileSync(path.join(stateDir, "tray-status.json"), JSON.stringify(info, null, 2));
  } catch {}
}

function createTray() {
  if (tray) return;

  const initialStatus = orchestrator.getStatus();
  const icon = getTrayIcon(initialStatus.state);
  tray = new Tray(icon);
  tray.setToolTip(getStatusTooltip(initialStatus.state));

  tray.on("double-click", () => {
    restoreMainWindow();
  });

  tray.on("click", () => {
    restoreMainWindow();
  });

  updateTrayMenu();
  addLog("INFO", "Windows System Tray icon created (PdaNet+-style background mode active).");
}

async function handleApplicationExit() {
  if (isQuitting) return;
  isQuitting = true;
  addLog("INFO", "Application exit requested. Ensuring clean network restoration...");

  try {
    const status = orchestrator.getStatus();
    if (status.state !== "DISCONNECTED") {
      const res = await orchestrator.disconnect();
      if (!res.success) {
        throw new Error(res.message);
      }
    }
    engineLauncher.cleanupStaleState(stateDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog("ERROR", `Network restoration warning on exit: ${msg}`);
    try {
      dialog.showErrorBox(
        "USB VPN Bridge - Network Restoration Notice",
        `A network restoration warning occurred during exit:\n\n${msg}\n\nEmergency restoration script is available at:\n${path.join(stateDir, "restore-routes.bat")}`
      );
    } catch {}
  } finally {
    if (tray && !tray.isDestroyed()) {
      try {
        tray.destroy();
      } catch {}
      tray = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.destroy();
      } catch {}
      mainWindow = null;
    }
    app.quit();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 800,
    minWidth: 900,
    minHeight: 700,
    backgroundColor: "#090d16",
    autoHideMenuBar: true,
    title: "USB VPN Bridge",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  });

  const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Requirement 2: Minimize hides window to Windows System Tray
  mainWindow.on("minimize", () => {
    mainWindow?.hide();
    addLog("INFO", "Window minimized to Windows System Tray (Hidden Icons ^). Tethering remains active.");
    exportTrayStatus();
  });

  // Requirement 3: Clicking X hides window instead of quitting
  mainWindow.on("close", (event: Electron.Event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      addLog("INFO", "Window closed to Windows System Tray. Background tethering continues active.");
      exportTrayStatus();
    }
  });

  mainWindow.on("restore", () => {
    addLog("DEBUG", "Application window restored. Refreshing UI state immediately.");
    syncRendererState();
    exportTrayStatus();
  });

  mainWindow.on("focus", () => {
    syncRendererState();
    exportTrayStatus();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    exportTrayStatus();
  });
}

// Second instance handling: focus existing window if user runs EXE a second time
app.on("second-instance", () => {
  restoreMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // In system tray mode, closing the window does NOT terminate the application.
  // The application continues running in the background until Exit is clicked.
  if (isQuitting) {
    if (process.platform !== "darwin") {
      app.quit();
    }
  }
});

app.whenReady().then(async () => {
  setupIpcHandlers();
  createWindow();
  createTray();

  // Safely detect and recover from any stale session locks from an ungraceful previous run
  const staleCleanup = engineLauncher.cleanupStaleState(stateDir);
  if (staleCleanup.cleaned) {
    addLog("WARN", `Startup recovery: ${staleCleanup.reason}`);
  }

  addLog("INFO", "USB VPN Bridge Windows client initialized (System Tray Mode active)");
  addLog("INFO", `Using ADB binary: ${adbManager.getResolvedAdbPath()}`);

  const binInfo = engineLauncher.detectBinaries();
  if (binInfo.binaryFound) {
    addLog(
      "INFO",
      `Found official sing-box binary: ${engineLauncher.getBinaryPath()} (v${engineLauncher.getEngineVersion()})`
    );
  }
  if (binInfo.wintunFound) {
    addLog("INFO", `Found verified Wintun driver: ${engineLauncher.getWintunPath()}`);
  }

  // Hook orchestrator logs and status changes
  orchestrator.on("log", (l: { level: "INFO" | "WARN" | "ERROR"; message: string }) => {
    addLog(l.level, l.message);
  });

  orchestrator.on("status-change", (status: OrchestratorStatus) => {
    syncPowerSaveBlocker(status.state);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("orchestrator:status-change", status);
    }
    broadcastRoutingStatus();
    updateTrayMenu();

    // Persist live status for diagnostics & testing
    try {
      fs.writeFileSync(path.join(stateDir, "orchestrator-live-status.json"), JSON.stringify(status, null, 2));
    } catch {}
  });

  // Background Main Process device poller: runs independent of renderer window minimize / throttle state
  let lastDeviceFingerprint = "";
  setInterval(async () => {
    try {
      const devices = await adbManager.getDevices();
      const fingerprint = JSON.stringify(devices.map((d) => ({ serial: d.serial, state: d.state })));
      if (fingerprint !== lastDeviceFingerprint) {
        lastDeviceFingerprint = fingerprint;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("adb:devices-changed", devices);
        }
      }
    } catch {}
  }, 2500);

  // Watch for external UI test triggers
  setInterval(async () => {
    const connectTrigger = path.join(stateDir, "trigger-connect.run");
    const disconnectTrigger = path.join(stateDir, "trigger-disconnect.run");
    const minimizeTrigger = path.join(stateDir, "trigger-minimize.run");
    const restoreTrigger = path.join(stateDir, "trigger-restore.run");
    const trayStatusTrigger = path.join(stateDir, "trigger-tray-status.run");
    const exitTrigger = path.join(stateDir, "trigger-exit.run");

    if (fs.existsSync(connectTrigger)) {
      try { fs.unlinkSync(connectTrigger); } catch {}
      addLog("INFO", "[TRIGGER] One-Click Connect triggered...");
      await orchestrator.connect();
    }

    if (fs.existsSync(disconnectTrigger)) {
      try { fs.unlinkSync(disconnectTrigger); } catch {}
      addLog("INFO", "[TRIGGER] One-Click Disconnect triggered...");
      await orchestrator.disconnect();
    }

    if (fs.existsSync(minimizeTrigger)) {
      try { fs.unlinkSync(minimizeTrigger); } catch {}
      addLog("INFO", "[TRIGGER] Minimize to tray triggered...");
      mainWindow?.hide();
      exportTrayStatus();
    }

    if (fs.existsSync(restoreTrigger)) {
      try { fs.unlinkSync(restoreTrigger); } catch {}
      addLog("INFO", "[TRIGGER] Restore from tray triggered...");
      restoreMainWindow();
    }

    if (fs.existsSync(trayStatusTrigger)) {
      try { fs.unlinkSync(trayStatusTrigger); } catch {}
      updateTrayMenu();
    }

    if (fs.existsSync(exitTrigger)) {
      try { fs.unlinkSync(exitTrigger); } catch {}
      addLog("INFO", "[TRIGGER] Exit triggered...");
      await handleApplicationExit();
    }
  }, 500);

  engineLauncher.on("log", (log) => {
    addLog(log.level, `[sing-box] ${log.message}`);
  });

  engineLauncher.on("statusChange", () => {
    broadcastRoutingStatus();
  });

  // Safe pre-inspection of Windows network state
  try {
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    addLog("INFO", "Executing baseline Windows network inspection...");
    const inspection = await NetworkInspector.inspectNetwork();
    networkSnapshot = inspection.snapshot;
    NetworkInspector.saveSnapshot(path.join(stateDir, "network-state-snapshot.json"), networkSnapshot);

    addLog(
      "INFO",
      `Network inspection complete: ${inspection.adapters.length} adapters detected. Primary: ${
        inspection.primaryAdapter ? inspection.primaryAdapter.name : "None"
      }`
    );

    RouteRestorer.saveRecoveryScripts(stateDir, networkSnapshot);
  } catch (err) {
    addLog("WARN", `Network inspection warning: ${err instanceof Error ? err.message : String(err)}`);
  }

  controlClient.onLog((level, msg) => {
    addLog(level, msg);
  });

  controlClient.onStateChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("control:state-change", state);
    }
    broadcastRoutingStatus();
    updateTrayMenu();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      restoreMainWindow();
    }
  });
});

function setupIpcHandlers() {
  ipcMain.handle("app:get-version", () => {
    return app.getVersion();
  });

  // Orchestrator APIs
  ipcMain.handle("orchestrator:get-status", (): OrchestratorStatus => {
    return orchestrator.getStatus();
  });

  ipcMain.handle("orchestrator:connect", async (_, serial?: string) => {
    return await orchestrator.connect(serial);
  });

  ipcMain.handle("orchestrator:disconnect", async () => {
    return await orchestrator.disconnect();
  });

  ipcMain.handle("orchestrator:restore", async () => {
    return await orchestrator.emergencyRestore();
  });

  // ADB & Device APIs
  ipcMain.handle("adb:list-devices", async (): Promise<AdbDevice[]> => {
    try {
      const devices = await adbManager.getDevices();
      return devices;
    } catch (err) {
      addLog("ERROR", `Failed to query ADB devices: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  });

  ipcMain.handle("control:get-state", (): ControlSessionInfo => {
    return controlClient.getSessionInfo();
  });

  ipcMain.handle("network:get-routing-status", (): SystemRoutingStatus => {
    return computeRoutingStatus();
  });

  ipcMain.handle("network:get-inspection", async () => {
    if (!networkSnapshot) {
      const res = await NetworkInspector.inspectNetwork();
      networkSnapshot = res.snapshot;
    }
    return {
      primaryAdapter: networkSnapshot.primaryAdapterName,
      defaultGateway: networkSnapshot.defaultIpv4Gateway,
      metric: networkSnapshot.defaultIpv4Metric,
      activeVpnAdapters: networkSnapshot.activeVpnAdaptersFound,
      recoveryScriptReady: true,
    };
  });

  ipcMain.handle(
    "proxy:test-connection",
    async (): Promise<{ success: boolean; egressIp?: string; latencyMs?: number; error?: string }> => {
      try {
        const devices = await adbManager.getDevices();
        const authorized = devices.filter((d) => d.state === "device");
        if (authorized.length > 0) {
          const serial = orchestrator.getStatus().serial || authorized[0].serial;
          await adbManager.forwardPort(serial, 10808, 10808);
        }
      } catch (fwdErr) {
        addLog("WARN", `ADB forward check before proxy test: ${fwdErr instanceof Error ? fwdErr.message : String(fwdErr)}`);
      }

      addLog(
        "INFO",
        "Initiating SOCKS5 proxy diagnostic test (curl.exe --proxy socks5h://127.0.0.1:10808 https://api.ipify.org)..."
      );
      const startTime = Date.now();

      return new Promise((resolve) => {
        execFile(
          "curl.exe",
          ["--proxy", "socks5h://127.0.0.1:10808", "https://api.ipify.org", "-s", "-m", "10", "--connect-timeout", "6"],
          { timeout: 12000, windowsHide: true },
          (err, stdout, stderr) => {
            const latencyMs = Date.now() - startTime;
            if (err) {
              const errMsg = stderr?.trim() || err.message;
              addLog("ERROR", `Proxy diagnostic test failed (${latencyMs}ms): ${errMsg}`);
              broadcastRoutingStatus();
              resolve({ success: false, latencyMs, error: errMsg });
            } else {
              const egressIp = stdout.trim();
              addLog("INFO", `Proxy diagnostic test SUCCESS! Egress Public IP: ${egressIp} (${latencyMs}ms)`);
              broadcastRoutingStatus();
              resolve({ success: true, egressIp, latencyMs });
            }
          }
        );
      });
    }
  );

  ipcMain.handle("logs:get", (): LogEntry[] => {
    return [...memoryLogs];
  });
}
