import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface AdbDevice {
  serial: string;
  state: "device" | "unauthorized" | "offline" | "unknown";
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
}

export class AdbManager {
  private adbPath: string | null = null;
  private isPolling = false;

  constructor() {
    this.adbPath = this.locateAdb();
  }

  /**
   * Locates adb.exe by testing packaged extraResources, known SDK locations, and PATH.
   */
  public locateAdb(): string | null {
    const resourcesPath = (process as any).resourcesPath;
    const candidates = [
      resourcesPath ? path.join(resourcesPath, "bin", "adb", "adb.exe") : "",
      path.resolve(__dirname, "../bin/adb/adb.exe"),
      path.resolve(__dirname, "../../bin/adb/adb.exe"),
      path.resolve(process.cwd(), "bin/adb/adb.exe"),
      "C:\\platform-tools\\adb.exe",
      "C:\\Android\\Sdk\\platform-tools\\adb.exe",
      path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe"),
      path.join(process.env.ANDROID_HOME || "", "platform-tools", "adb.exe"),
      "adb.exe",
      "adb",
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (candidate === "adb.exe" || candidate === "adb") {
        return candidate; // Let OS PATH resolve
      }
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return "adb.exe";
  }

  public getResolvedAdbPath(): string {
    return this.adbPath || "adb.exe";
  }

  /**
   * Executes adb with arguments safely using execFile.
   */
  private execAdb(args: string[], timeoutMs = 8000): Promise<string> {
    const binary = this.getResolvedAdbPath();
    let androidDir: string;
    try {
      const { app } = require("electron");
      androidDir = app ? path.join(app.getPath("userData"), ".android") : path.resolve(process.cwd(), ".android");
    } catch {
      androidDir = path.resolve(process.cwd(), ".android");
    }
    if (!fs.existsSync(androidDir)) {
      try {
        fs.mkdirSync(androidDir, { recursive: true });
      } catch {}
    }
    const env = {
      ...process.env,
      ANDROID_USER_HOME: process.env.ANDROID_USER_HOME || androidDir,
    };
    return new Promise((resolve, reject) => {
      execFile(binary, args, { env, timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          const errMsg = stderr?.trim() || err.message;
          reject(new Error(`ADB execution failed [${args.join(" ")}]: ${errMsg}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Parses `adb devices -l` output into structured AdbDevice records.
   */
  public async getDevices(): Promise<AdbDevice[]> {
    try {
      const output = await this.execAdb(["devices", "-l"]);
      return this.parseDevicesOutput(output);
    } catch (err) {
      throw new Error(`Failed to list ADB devices: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public parseDevicesOutput(output: string): AdbDevice[] {
    const lines = output.split(/\r?\n/);
    const devices: AdbDevice[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("List of devices attached") || trimmed.startsWith("*")) {
        continue;
      }

      // Format example:
      // 00058342T000159        device product:PacmanIND model:A142 device:Pacman transport_id:5
      // 00058342T000159        unauthorized
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const serial = parts[0];
        const stateStr = parts[1].toLowerCase();
        let state: AdbDevice["state"] = "unknown";
        if (stateStr === "device") state = "device";
        else if (stateStr === "unauthorized") state = "unauthorized";
        else if (stateStr === "offline") state = "offline";

        let model: string | undefined;
        let product: string | undefined;
        let device: string | undefined;
        let transportId: string | undefined;

        for (let i = 2; i < parts.length; i++) {
          const item = parts[i];
          if (item.startsWith("model:")) model = item.substring(6);
          else if (item.startsWith("product:")) product = item.substring(8);
          else if (item.startsWith("device:")) device = item.substring(7);
          else if (item.startsWith("transport_id:")) transportId = item.substring(13);
        }

        devices.push({
          serial,
          state,
          model,
          product,
          device,
          transportId,
        });
      }
    }

    return devices;
  }

  /**
   * Forwards a local TCP port to the remote device TCP port.
   * `adb -s <serial> forward tcp:<localPort> tcp:<remotePort>`
   */
  public async forwardPort(serial: string, localPort: number, remotePort: number): Promise<void> {
    if (!serial || !/^[a-zA-Z0-9._:-]+$/.test(serial)) {
      throw new Error(`Invalid device serial: ${serial}`);
    }
    if (localPort <= 0 || localPort > 65535 || remotePort <= 0 || remotePort > 65535) {
      throw new Error(`Invalid port numbers: local=${localPort}, remote=${remotePort}`);
    }

    await this.execAdb(["-s", serial, "forward", `tcp:${localPort}`, `tcp:${remotePort}`]);
  }

  /**
   * Removes a specific forwarded port for the given device.
   * `adb -s <serial> forward --remove tcp:<localPort>`
   */
  public async removeForward(serial: string, localPort: number): Promise<void> {
    if (!serial || !/^[a-zA-Z0-9._:-]+$/.test(serial)) return;
    try {
      await this.execAdb(["-s", serial, "forward", "--remove", `tcp:${localPort}`]);
    } catch {
      // Ignore errors if forward was already removed
    }
  }

  /**
   * Lists all active forwards across ADB.
   */
  public async listForwards(): Promise<string> {
    return this.execAdb(["forward", "--list"]);
  }
}
