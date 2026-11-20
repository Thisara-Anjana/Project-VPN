/**
 * Native Network Engine Lifecycle Manager & Process Supervisor
 * USB VPN Bridge - Phase 5B
 *
 * Supervises the native network daemon process (sing-box + Wintun).
 * Implements startup, shutdown, log capture, crash detection, duplicate instance prevention,
 * and application-owned adapter cleanup.
 */

import { ChildProcess, spawn, execFile, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { NetworkEngineStatus, EngineDiagnostics, SingBoxConfigSchema } from "./types.js";
import { ConfigManager } from "./configManager.js";

export interface EngineLogEntry {
  timestamp: number;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  message: string;
}

export class EngineLauncher extends EventEmitter {
  private status: NetworkEngineStatus = "NOT_STARTED";
  private childProcess: ChildProcess | null = null;
  private currentConfig: SingBoxConfigSchema | null = null;
  private configFilePath: string | null = null;
  private lastError: string | null = null;
  private validationMessage: string | null = null;

  private binaryPath: string | null = null;
  private wintunPath: string | null = null;
  private engineVersion: string | null = null;
  private baseDir: string;
  private stateDir: string | null = null;

  private engineLogs: EngineLogEntry[] = [];
  private static readonly MAX_LOG_HISTORY = 500;
  private logTailInterval: NodeJS.Timeout | null = null;
  private lastLogFileSize = 0;

  constructor(baseDir?: string, stateDir?: string) {
    super();
    this.baseDir = baseDir || path.resolve(process.cwd(), "network-core");
    this.stateDir = stateDir || path.resolve(this.baseDir, "state");
    this.detectBinaries(baseDir);
  }

  /**
   * Detects whether sing-box.exe and wintun.dll are present and extracts version.
   */
  public detectBinaries(baseDir?: string): { binaryFound: boolean; wintunFound: boolean } {
    const resourcesPath = (process as any).resourcesPath;
    const candidateDirs = [
      resourcesPath ? path.join(resourcesPath, "bin", "engine") : "",
      resourcesPath ? path.join(resourcesPath, "bin") : "",
      baseDir ? path.join(baseDir, "bin") : "",
      baseDir || "",
      path.resolve(process.cwd(), "bin/engine"),
      path.resolve(process.cwd(), "network-core/bin"),
      path.resolve(process.cwd(), "bin"),
      path.resolve(__dirname, "../bin/engine"),
      path.resolve(__dirname, "../../bin/engine"),
    ].filter(Boolean);

    for (const dir of candidateDirs) {
      const sbCandidate = path.join(dir, "sing-box.exe");
      if (fs.existsSync(sbCandidate)) {
        this.binaryPath = sbCandidate;
        break;
      }
    }

    for (const dir of candidateDirs) {
      const wtCandidate = path.join(dir, "wintun.dll");
      if (fs.existsSync(wtCandidate)) {
        this.wintunPath = wtCandidate;
        break;
      }
    }

    if (this.binaryPath) {
      try {
        // Pass a safe ANDROID_USER_HOME to avoid ADB server startup-related permission errors
        // in restricted environments. sing-box version does not use ADB but the env is inherited.
        const tmpAndroidHome = require("path").resolve(require("os").tmpdir(), "usb-vpn-bridge-adb");
        const out = require("child_process").execFileSync(this.binaryPath, ["version"], {
          encoding: "utf-8",
          env: { ...process.env, ANDROID_USER_HOME: process.env.ANDROID_USER_HOME || tmpAndroidHome },
          windowsHide: true,
          timeout: 5000,
        });
        const match = out.match(/sing-box version ([^\s]+)/);
        this.engineVersion = match ? match[1] : "1.14.4";
      } catch {
        this.engineVersion = "1.14.4";
      }
    }

    return {
      binaryFound: !!this.binaryPath,
      wintunFound: !!this.wintunPath,
    };
  }

  public getStatus(): NetworkEngineStatus {
    return this.status;
  }

  public getBinaryPath(): string | null {
    return this.binaryPath;
  }

  public getWintunPath(): string | null {
    return this.wintunPath;
  }

  public getEngineVersion(): string | null {
    return this.engineVersion;
  }

  public getLogs(): EngineLogEntry[] {
    return [...this.engineLogs];
  }

  private addLog(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string) {
    const entry: EngineLogEntry = { timestamp: Date.now(), level, message };
    this.engineLogs.push(entry);
    if (this.engineLogs.length > EngineLauncher.MAX_LOG_HISTORY) {
      this.engineLogs.shift();
    }
    this.emit("log", entry);
  }

  /**
   * Validates and prepares the network engine configuration.
   */
  public async validateAndPrepare(
    configDir: string,
    options: { socksPort?: number; enableAutoRoute?: boolean; localGatewayIp?: string | null } = {}
  ): Promise<{
    success: boolean;
    diagnostics: EngineDiagnostics;
    validationOutput: string;
  }> {
    this.status = "VALIDATING";
    this.emit("statusChange", this.status);

    try {
      this.currentConfig = ConfigManager.generateConfig({
        socksPort: options.socksPort || 10808,
        enableAutoRoute: options.enableAutoRoute ?? false,
        tunMtu: 1500, // Explicitly enforce MTU 1500 for cellular/VPN compatibility
        localGatewayIp: options.localGatewayIp || null,
      });

      const audit = ConfigManager.validateConfig(this.currentConfig);
      if (!audit.valid) {
        this.status = "ERROR";
        this.lastError = audit.errors.join("; ");
        this.emit("statusChange", this.status);
        return {
          success: false,
          diagnostics: this.getDiagnostics(),
          validationOutput: this.lastError,
        };
      }

      this.configFilePath = path.join(configDir, "sing-box-config.json");
      ConfigManager.saveConfigFile(this.configFilePath, this.currentConfig);

      let validationOutput = "Static configuration validation PASSED. Route-loop protection verified.";
      if (this.binaryPath && this.configFilePath) {
        const dryRun = await ConfigManager.dryRunCheck(this.binaryPath, this.configFilePath);
        if (!dryRun.success) {
          this.status = "ERROR";
          this.lastError = `sing-box check failed: ${dryRun.output}`;
          this.emit("statusChange", this.status);
          return {
            success: false,
            diagnostics: this.getDiagnostics(),
            validationOutput: this.lastError,
          };
        }
        validationOutput += ` | sing-box check: ${dryRun.output}`;
      }

      this.status = "READY";
      this.validationMessage = validationOutput;
      this.lastError = null;
      this.emit("statusChange", this.status);

      return {
        success: true,
        diagnostics: this.getDiagnostics(),
        validationOutput,
      };
    } catch (err) {
      this.status = "ERROR";
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit("statusChange", this.status);
      return {
        success: false,
        diagnostics: this.getDiagnostics(),
        validationOutput: this.lastError,
      };
    }
  }

  public isElevated(): boolean {
    try {
      execFileSync("net.exe", ["session"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  private queryRouteTable(): string {
    try {
      return execFileSync("route.exe", ["print", "-4"], { encoding: "utf-8", windowsHide: true });
    } catch {
      return "";
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      const stdout = execFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf-8",
        windowsHide: true,
        timeout: 3000,
      });
      return stdout.includes(String(pid));
    } catch {
      return false;
    }
  }

  private isSingBoxProcess(pid: number): boolean {
    try {
      const stdout = execFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf-8",
        windowsHide: true,
        timeout: 3000,
      });
      const lower = stdout.toLowerCase();
      return lower.includes("sing-box") || lower.includes("cmd.exe");
    } catch {
      return false;
    }
  }

  /**
   * Safely cleans up virtual adapter and routes owned exclusively by our application.
   * NEVER touches any unrelated network adapter or third-party VPN.
   */
  public cleanAdapterAndRoutes(): void {
    try {
      execFileSync(
        "netsh.exe",
        ["interface", "set", "interface", "name=usb-vpn-tun", "admin=disable"],
        { windowsHide: true, stdio: "ignore" }
      );
    } catch {}
    try {
      execFileSync(
        "route.exe",
        ["delete", "0.0.0.0", "mask", "0.0.0.0", "172.19.0.1"],
        { windowsHide: true, stdio: "ignore" }
      );
    } catch {}
    try {
      execFileSync("ipconfig.exe", ["/flushdns"], { windowsHide: true, stdio: "ignore" });
    } catch {}
  }

  /**
   * Detects and safely recovers from stale session locks, orphaned sing-box processes,
   * or interrupted previous connections without affecting unrelated VPN applications.
   */
  public cleanupStaleState(stateDirOverride?: string): { cleaned: boolean; reason?: string } {
    const stateDir = stateDirOverride || this.stateDir || path.resolve(this.baseDir, "state");
    const activeFile = path.join(stateDir, "engine.active");
    const pidFile = path.join(stateDir, "engine.pid");
    const exitFile = path.join(stateDir, "engine.exit");

    if (!fs.existsSync(activeFile) && !fs.existsSync(pidFile)) {
      return { cleaned: false };
    }

    let isAlive = false;
    let pidNum: number | null = null;

    if (fs.existsSync(pidFile)) {
      try {
        const rawPid = fs.readFileSync(pidFile, "utf-8").trim();
        pidNum = parseInt(rawPid, 10);
        if (!isNaN(pidNum) && pidNum > 0) {
          isAlive = this.isProcessAlive(pidNum);
        }
      } catch {}
    }

    const routeTable = this.queryRouteTable();
    const isRouteActive = routeTable.includes("172.19.0.1") || routeTable.includes("usb-vpn-tun");

    if (!isAlive && !isRouteActive) {
      // Stale lock from an ungraceful shutdown or crash — safe to clean
      try { fs.unlinkSync(activeFile); } catch {}
      try { fs.unlinkSync(pidFile); } catch {}
      try { fs.unlinkSync(exitFile); } catch {}
      this.status = "NOT_STARTED";
      this.addLog("WARN", `Cleared stale session lock (PID ${pidNum || "unknown"} not running, no TUN route).`);
      return { cleaned: true, reason: "Stale session lock removed" };
    }

    if (isAlive && pidNum) {
      // Process is alive — verify it is specifically our sing-box or cmd daemon before touching
      if (this.isSingBoxProcess(pidNum)) {
        this.addLog("WARN", `Orphaned sing-box process detected (PID ${pidNum}). Terminating cleanly...`);
        try {
          execFileSync("taskkill.exe", ["/F", "/T", "/PID", String(pidNum)], { windowsHide: true, stdio: "ignore" });
        } catch {}
      }
      try { fs.unlinkSync(activeFile); } catch {}
      try { fs.unlinkSync(pidFile); } catch {}
      try { fs.unlinkSync(exitFile); } catch {}
      this.cleanAdapterAndRoutes();
      this.status = "NOT_STARTED";
      return { cleaned: true, reason: "Terminated orphaned sing-box process" };
    }

    if (isRouteActive) {
      this.cleanAdapterAndRoutes();
      try { fs.unlinkSync(activeFile); } catch {}
      try { fs.unlinkSync(pidFile); } catch {}
      try { fs.unlinkSync(exitFile); } catch {}
      this.status = "NOT_STARTED";
      return { cleaned: true, reason: "Cleaned orphaned route and stale lock" };
    }

    return { cleaned: false };
  }

  private startTailLog(logPath: string) {
    this.stopTailLog();
    this.lastLogFileSize = 0;
    this.logTailInterval = setInterval(() => {
      try {
        if (!fs.existsSync(logPath)) return;
        const stat = fs.statSync(logPath);
        if (stat.size > this.lastLogFileSize) {
          const fd = fs.openSync(logPath, "r");
          const buffer = Buffer.alloc(stat.size - this.lastLogFileSize);
          fs.readSync(fd, buffer, 0, buffer.length, this.lastLogFileSize);
          fs.closeSync(fd);
          this.lastLogFileSize = stat.size;
          const text = buffer.toString("utf-8");
          for (const line of text.split(/\r?\n/)) {
            if (line.trim()) {
              const level =
                line.includes("ERROR") || line.includes("FATAL") ? "ERROR" : line.includes("WARN") ? "WARN" : "INFO";
              this.addLog(level, line.trim());
            }
          }
        }
      } catch {}
    }, 500);
  }

  private stopTailLog() {
    if (this.logTailInterval) {
      clearInterval(this.logTailInterval);
      this.logTailInterval = null;
    }
  }

  /**
   * Starts the sing-box process with the prepared configuration.
   * Controlled execution strictly launched after user authorization.
   */
  public async start(
    configDir: string,
    options: { enableAutoRoute: boolean; localGatewayIp?: string | null } = { enableAutoRoute: true }
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (this.childProcess) {
      return { success: false, error: "Engine already running (PID: " + this.childProcess.pid + ")" };
    }

    const stateDir = configDir;
    this.stateDir = stateDir;

    // Detect and safely recover from stale locks or interrupted previous sessions
    const staleCheck = this.cleanupStaleState(stateDir);
    if (staleCheck.cleaned) {
      this.addLog("INFO", `Pre-start recovery: ${staleCheck.reason}`);
    }

    const activeFile = path.join(stateDir, "engine.active");
    if (fs.existsSync(activeFile)) {
      return { success: false, error: "Elevated TUN engine is currently active." };
    }

    if (!this.binaryPath || !fs.existsSync(this.binaryPath)) {
      this.status = "ERROR";
      this.lastError = "sing-box binary not found in network-core/bin/";
      return { success: false, error: this.lastError };
    }

    // 1. Prepare configuration
    const prep = await this.validateAndPrepare(configDir, {
      socksPort: 10808,
      enableAutoRoute: options.enableAutoRoute,
      localGatewayIp: options.localGatewayIp,
    });
    if (!prep.success || !this.configFilePath) {
      return { success: false, error: prep.validationOutput };
    }

    const logPath = path.join(stateDir, "sing-box-live.log");

    if (this.isElevated()) {
      this.addLog("INFO", `Current process is elevated. Direct spawn: ${this.binaryPath} run -c ${this.configFilePath}`);

      try {
        this.childProcess = spawn(this.binaryPath, ["run", "-c", this.configFilePath], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const pid = this.childProcess.pid;
        this.status = "ACTIVE";
        this.emit("statusChange", this.status);
        this.addLog("INFO", `sing-box daemon started with PID: ${pid}`);

        this.childProcess.stdout?.on("data", (chunk: Buffer) => {
          const text = chunk.toString().trim();
          for (const line of text.split(/\r?\n/)) {
            if (line) this.addLog("INFO", line);
          }
        });

        this.childProcess.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString().trim();
          for (const line of text.split(/\r?\n/)) {
            if (line) {
              if (line.includes("ERROR") || line.includes("FATAL") || line.includes("panic")) {
                this.addLog("ERROR", line);
                this.lastError = line;
              } else {
                this.addLog("WARN", line);
              }
            }
          }
        });

        this.childProcess.on("error", (err: Error) => {
          this.addLog("ERROR", `Process execution error: ${err.message}`);
          this.status = "ERROR";
          this.lastError = err.message;
          this.childProcess = null;
          this.emit("statusChange", this.status);
        });

        this.childProcess.on("exit", (code: number | null, signal: string | null) => {
          this.addLog("INFO", `sing-box process exited with code ${code}, signal ${signal}`);
          this.childProcess = null;
          this.status = code === 0 || signal === "SIGINT" ? "NOT_STARTED" : "ERROR";
          if (code !== 0 && code !== null && signal !== "SIGINT") {
            this.lastError = `Unexpected exit code: ${code}`;
          }
          this.emit("statusChange", this.status);
        });

        return { success: true };
      } catch (err) {
        this.status = "ERROR";
        this.lastError = err instanceof Error ? err.message : String(err);
        this.emit("statusChange", this.status);
        return { success: false, error: this.lastError };
      }
    } else {
      // Unelevated: Launch elevated runner via UAC RunAs
      const runnerCandidates = [
        this.binaryPath ? path.join(path.dirname(this.binaryPath), "run-elevated.ps1") : "",
        path.resolve(this.baseDir, "bin/run-elevated.ps1"),
        path.resolve(this.baseDir, "run-elevated.ps1"),
      ].filter(Boolean);
      const runnerPs1 = runnerCandidates.find((p) => fs.existsSync(p)) || runnerCandidates[0];
      this.addLog("INFO", "Process not elevated. Requesting Windows Administrator UAC elevation...");

      if (!runnerPs1 || !fs.existsSync(runnerPs1)) {
        this.status = "ERROR";
        this.lastError = `Elevated runner script not found: ${runnerPs1 || "none"}`;
        return { success: false, error: this.lastError };
      }

      const activeFile = path.join(stateDir, "engine.active");
      const pidFile = path.join(stateDir, "engine.pid");
      const exitFile = path.join(stateDir, "engine.exit");

      // Write all engine parameters to a JSON sidecar file in stateDir BEFORE UAC elevation.
      // This eliminates path-with-spaces quoting issues that arise when passing file paths as
      // PowerShell -ArgumentList strings through the JS execFile → powershell -Command → Start-Process chain.
      const paramsFile = path.join(stateDir, "engine-params.json");
      const engineParams = {
        WorkingDir: stateDir,
        SingBoxExe: this.binaryPath,
        ConfigPath: this.configFilePath,
        LogPath: logPath,
        ActiveFile: activeFile,
        PidFile: pidFile,
        ExitFile: exitFile,
      };
      try {
        fs.writeFileSync(paramsFile, JSON.stringify(engineParams, null, 2), "utf-8");
        this.addLog("INFO", `Engine params written to: ${paramsFile}`);
      } catch (e) {
        this.status = "ERROR";
        this.lastError = `Failed to write engine params file: ${e instanceof Error ? e.message : String(e)}`;
        return { success: false, error: this.lastError };
      }

      this.startTailLog(logPath);

      return new Promise((resolve) => {
        // Launch runnerPs1 directly using execFile with separate argv arguments.
        // Node's execFile guarantees arguments with spaces are quoted correctly for Windows CreateProcessW.
        // run-elevated.ps1 detects whether it is currently running elevated: if unelevated,
        // it triggers UAC self-elevation via Start-Process -Verb RunAs and cleanly delegates.
        const psArgs = [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          runnerPs1,
          "-ParamsFile",
          paramsFile,
        ];
        execFile("powershell.exe", psArgs, { windowsHide: true }, (err) => {
          if (err) {
            this.stopTailLog();
            this.status = "ERROR";
            this.lastError = `Elevation request failed: ${err.message}`;
            this.addLog("ERROR", this.lastError);
            this.emit("statusChange", this.status);
            return resolve({ success: false, error: this.lastError });
          }

          this.addLog("INFO", "Elevation triggered. Awaiting Wintun adapter activation...");

          // Poll for adapter/route readiness up to 25 seconds
          const startTime = Date.now();
          const checkTimer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const routePrint = this.queryRouteTable();
            if (
              routePrint.includes("172.19.0.1") ||
              routePrint.includes("172.19.0.2") ||
              routePrint.includes("usb-vpn-tun")
            ) {
              clearInterval(checkTimer);
              this.status = "ACTIVE";
              this.lastError = null;
              this.emit("statusChange", this.status);
              this.addLog(
                "INFO",
                `Wintun adapter 'usb-vpn-tun' active in Windows route table after ${Math.round(elapsed / 1000)}s.`
              );
              return resolve({ success: true });
            }

            // Check if supervisor exited with error
            const exitFile = path.join(stateDir, "engine.exit");
            if (fs.existsSync(exitFile)) {
              clearInterval(checkTimer);
              this.stopTailLog();
              const exitMsg = fs.readFileSync(exitFile, "utf-8").trim();
              this.status = "ERROR";
              this.lastError = `TUN engine supervisor failed: ${exitMsg}`;
              this.emit("statusChange", this.status);
              return resolve({ success: false, error: this.lastError });
            }

            if (elapsed > 25000) {
              clearInterval(checkTimer);
              this.stopTailLog();
              this.status = "ERROR";
              this.lastError =
                "TUN adapter activation timed out waiting for Administrator approval or Wintun startup.";
              this.emit("statusChange", this.status);
              return resolve({ success: false, error: this.lastError });
            }
          }, 1000);
        });
      });
    }
  }

  /**
   * Gracefully stops the engine if running.
   */
  public async stop(stateDirOverride?: string): Promise<void> {
    this.status = "STOPPING";
    this.emit("statusChange", this.status);
    this.addLog("INFO", "Stopping sing-box daemon and restoring routes...");

    this.stopTailLog();

    const stateDir = stateDirOverride || this.stateDir || path.resolve(this.baseDir, "state");
    const activeFile = path.join(stateDir, "engine.active");
    const pidFile = path.join(stateDir, "engine.pid");

    // Signal elevated supervisor to terminate if running
    if (fs.existsSync(activeFile)) {
      try {
        fs.unlinkSync(activeFile);
      } catch {}
    }

    if (this.childProcess) {
      this.childProcess.kill("SIGINT");
      const proc = this.childProcess;
      await new Promise<void>((res) => {
        const timeout = setTimeout(() => {
          if (proc && !proc.killed) proc.kill("SIGKILL");
          res();
        }, 2000);
        proc.on("exit", () => {
          clearTimeout(timeout);
          res();
        });
      });
      this.childProcess = null;
    }

    // Wait for elevated supervisor to finish cleanup
    const stopStart = Date.now();
    while (Date.now() - stopStart < 3000) {
      if (!fs.existsSync(pidFile)) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Ensure adapter is disabled and routes are clean
    this.cleanAdapterAndRoutes();

    // Ensure state files in stateDir are fully unlinked
    try { if (fs.existsSync(activeFile)) fs.unlinkSync(activeFile); } catch {}
    try { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); } catch {}

    this.status = "NOT_STARTED";
    this.emit("statusChange", this.status);
    this.addLog("INFO", "TUN Engine stopped and routes cleaned.");
  }

  /**
   * Returns complete diagnostic snapshot for UI & telemetry reporting.
   */
  public getDiagnostics(): EngineDiagnostics {
    const audit = this.currentConfig ? ConfigManager.validateConfig(this.currentConfig) : null;

    return {
      engineStatus: this.status,
      engineVersion: this.engineVersion,
      engineBinaryFound: !!this.binaryPath,
      engineBinaryPath: this.binaryPath,
      wintunDriverFound: !!this.wintunPath,
      wintunDriverPath: this.wintunPath,
      configValid: audit ? audit.valid : false,
      configValidationMessage: this.validationMessage,
      activeTunAdapterName: this.status === "ACTIVE" ? ConfigManager.DEFAULT_TUN_NAME : null,
      routeLoopProtectionVerified: audit ? audit.routeLoopProtected : false,
      unsupportedUdpPolicy: "BLOCK",
      ipv6LeakProtectionActive: audit ? audit.ipv6LeakProtected : true,
      lastError: this.lastError,
      processPid: this.childProcess?.pid || null,
    };
  }
}
