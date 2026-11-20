import net from "node:net";
import os from "node:os";
import {
  MessageType,
  ConnectionState,
  PROTOCOL_VERSION,
  DEFAULT_CONTROL_PORT,
  encodeFrame,
  StreamDeframer,
  createHelloMessage,
  createHeartbeatMessage,
  createDisconnectRequestMessage,
  ControlEnvelope,
  DeviceInfoPayload,
  HelloAckPayload,
  HeartbeatPayload,
  StatusPayload,
  ErrorPayload,
} from "@usb-vpn-bridge/shared-protocol";

export interface ControlSessionInfo {
  state: ConnectionState;
  deviceInfo: DeviceInfoPayload | null;
  latencyMs: number;
  sessionId: string | null;
  sessionStartTime: number;
  lastHeartbeatTime: number;
  errorMessage: string | null;
  activeSockets?: number;
  speedDownloadBps?: number;
  speedUploadBps?: number;
  bytesReceived?: number;
  bytesSent?: number;
  dataPort?: number;
}

export class ControlClient {
  private socket: net.Socket | null = null;
  private deframer: StreamDeframer = new StreamDeframer();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatSequence = 0;
  private lastPingSentTimestamp = 0;
  private missedHeartbeats = 0;
  private isExplicitlyDisconnecting = false;

  private sessionInfo: ControlSessionInfo = {
    state: ConnectionState.DISCONNECTED,
    deviceInfo: null,
    latencyMs: 0,
    sessionId: null,
    sessionStartTime: 0,
    lastHeartbeatTime: 0,
    errorMessage: null,
  };

  private onStateChangeCallback?: (info: ControlSessionInfo) => void;
  private onLogCallback?: (level: "INFO" | "WARN" | "ERROR", message: string) => void;

  public onStateChange(cb: (info: ControlSessionInfo) => void): void {
    this.onStateChangeCallback = cb;
  }

  public onLog(cb: (level: "INFO" | "WARN" | "ERROR", message: string) => void): void {
    this.onLogCallback = cb;
  }

  public getSessionInfo(): ControlSessionInfo {
    return { ...this.sessionInfo };
  }

  private log(level: "INFO" | "WARN" | "ERROR", message: string): void {
    if (this.onLogCallback) {
      this.onLogCallback(level, message);
    }
  }

  private updateState(partial: Partial<ControlSessionInfo>): void {
    this.sessionInfo = { ...this.sessionInfo, ...partial };
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this.getSessionInfo());
    }
  }

  /**
   * Connects to the local forwarded control port (127.0.0.1:10809)
   * and performs the protocol handshake.
   */
  public async connect(port = DEFAULT_CONTROL_PORT, timeoutMs = 6000): Promise<ControlSessionInfo> {
    if (this.socket) {
      this.disconnect();
    }

    this.isExplicitlyDisconnecting = false;
    this.deframer.reset();
    this.missedHeartbeats = 0;
    this.heartbeatSequence = 0;

    this.updateState({
      state: ConnectionState.HANDSHAKING,
      errorMessage: null,
    });
    this.log("INFO", `Connecting to Android control listener on 127.0.0.1:${port}...`);

    return new Promise((resolve, reject) => {
      let isResolved = false;
      const socket = new net.Socket();
      this.socket = socket;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.log("ERROR", "Control channel connection timed out during handshake.");
          this.cleanupSocket();
          this.updateState({
            state: ConnectionState.ERROR_STATE,
            errorMessage: "Connection timed out. Ensure the Android USB service is started.",
          });
          reject(new Error("Connection timed out waiting for Android response"));
        }
      }, timeoutMs);

      socket.connect(port, "127.0.0.1", () => {
        this.log("INFO", "TCP connection established. Sending HELLO frame...");
        try {
          const hostName = os.hostname();
          const helloMsg = createHelloMessage({
            protocolVersion: PROTOCOL_VERSION,
            clientId: hostName || `win_${Date.now().toString(36)}`,
            clientType: "WINDOWS_CLIENT",
            clientVersion: "1.0.0",
            capabilities: ["CONTROL_V1", "HEARTBEAT_V1", "DEVICE_INFO_V1", "SOCKS5_DATA_V1"],
          });
          const frame = encodeFrame(helloMsg);
          socket.write(frame);
        } catch (err) {
          clearTimeout(timeout);
          isResolved = true;
          this.cleanupSocket();
          reject(err);
        }
      });

      socket.on("data", (chunk: Buffer) => {
        try {
          const frames = this.deframer.push(chunk);
          for (const frame of frames) {
            this.handleIncomingFrame(frame, () => {
              if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                this.startHeartbeatLoop();
                resolve(this.getSessionInfo());
              }
            });
          }
        } catch (err) {
          this.log("ERROR", `Deframing error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      socket.on("error", (err: Error) => {
        this.log("ERROR", `Socket error: ${err.message}`);
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          this.updateState({
            state: ConnectionState.ERROR_STATE,
            errorMessage: `Socket error: ${err.message}. Is Android USB service started?`,
          });
          reject(err);
        }
        this.handleDisconnect();
      });

      socket.on("close", () => {
        this.log("WARN", "USB connection lost (socket closed).");
        this.handleDisconnect();
      });
    });
  }

  private handleIncomingFrame(frame: ControlEnvelope<unknown>, onHandshakeComplete: () => void): void {
    // Avoid logging every heartbeat frame to prevent flooding
    if (frame.type !== MessageType.HEARTBEAT) {
      this.log("INFO", `Received frame: type=${frame.type}, id=${frame.id}`);
    }

    switch (frame.type) {
      case MessageType.HELLO_ACK: {
        const payload = frame.payload as HelloAckPayload;
        if (!payload.accepted) {
          this.log("ERROR", `Handshake rejected: ${payload.rejectionReason || "Unknown reason"}`);
          this.updateState({
            state: ConnectionState.ERROR_STATE,
            errorMessage: `Handshake rejected: ${payload.rejectionReason}`,
          });
          this.disconnect();
          return;
        }

        this.log("INFO", `HELLO_ACK handshake completed (Session ID: ${payload.sessionId})`);
        this.log("INFO", "Android control session connected");
        const now = Date.now();
        this.missedHeartbeats = 0;
        this.updateState({
          state: ConnectionState.CONNECTED_IDLE,
          sessionId: payload.sessionId,
          sessionStartTime: now,
          lastHeartbeatTime: now,
        });
        onHandshakeComplete();
        break;
      }

      case MessageType.DEVICE_INFO: {
        const payload = frame.payload as DeviceInfoPayload;
        this.log("INFO", `Device Info: ${payload.manufacturer} ${payload.model} (Android ${payload.osVersion})`);
        this.updateState({
          deviceInfo: payload,
        });
        break;
      }

      case MessageType.HEARTBEAT: {
        const payload = frame.payload as HeartbeatPayload;
        const now = Date.now();
        const latency = payload.replyTimestamp ? now - payload.senderTimestamp : 0;
        this.missedHeartbeats = 0;
        this.updateState({
          latencyMs: Math.max(0, latency),
          lastHeartbeatTime: now,
          ...(payload.bytesReceived !== undefined ? { bytesReceived: payload.bytesReceived } : {}),
          ...(payload.bytesSent !== undefined ? { bytesSent: payload.bytesSent } : {}),
          ...(payload.speedDownloadBps !== undefined ? { speedDownloadBps: payload.speedDownloadBps } : {}),
          ...(payload.speedUploadBps !== undefined ? { speedUploadBps: payload.speedUploadBps } : {}),
          ...(payload.activeSockets !== undefined ? { activeSockets: payload.activeSockets } : {}),
        });
        break;
      }

      case MessageType.STATUS: {
        const payload = frame.payload as StatusPayload;
        this.updateState({
          activeSockets: payload.activeSockets,
          bytesReceived: payload.bytesReceived,
          bytesSent: payload.bytesSent,
          speedDownloadBps: payload.speedDownloadBps,
          speedUploadBps: payload.speedUploadBps,
          dataPort: payload.relayPort,
        });
        break;
      }

      case MessageType.ERROR: {
        const payload = frame.payload as ErrorPayload;
        this.log("ERROR", `Android reported error [${payload.code}]: ${payload.message}`);
        this.updateState({
          errorMessage: payload.message,
        });
        break;
      }

      default:
        this.log("WARN", `Unhandled frame type: ${frame.type}`);
    }
  }

  private startHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.sessionInfo.state !== ConnectionState.CONNECTED_IDLE) {
        return;
      }

      this.missedHeartbeats++;
      const now = Date.now();
      const lastHb = this.sessionInfo.lastHeartbeatTime || this.sessionInfo.sessionStartTime || now;
      const elapsedSinceLastHb = now - lastHb;

      // Generous watchdog tolerance (25 seconds or 15 consecutive ticks) ensures
      // window minimization, app switching, or heavy TCP download queueing does
      // not trip a false disconnect.
      if (this.missedHeartbeats >= 15 || (elapsedSinceLastHb > 25000 && this.missedHeartbeats >= 6)) {
        this.log("WARN", `Heartbeat timeout: Missed ${this.missedHeartbeats} consecutive heartbeats (${elapsedSinceLastHb}ms without reply). Connection lost.`);
        this.handleDisconnect();
        return;
      }

      this.heartbeatSequence++;
      this.lastPingSentTimestamp = now;
      const hbMsg = createHeartbeatMessage({
        sequence: this.heartbeatSequence,
        senderTimestamp: this.lastPingSentTimestamp,
      });

      try {
        const frame = encodeFrame(hbMsg);
        this.socket.write(frame);
      } catch (err) {
        this.log("ERROR", `Failed to transmit heartbeat: ${err instanceof Error ? err.message : String(err)}`);
        this.handleDisconnect();
      }
    }, 1500);
  }

  private handleDisconnect(): void {
    this.stopHeartbeatLoop();
    this.cleanupSocket();

    if (!this.isExplicitlyDisconnecting) {
      this.updateState({
        state: ConnectionState.DISCONNECTED,
        sessionId: null,
        sessionStartTime: 0,
      });
      this.log("WARN", "Phone disconnected.");
    }
  }

  private stopHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanupSocket(): void {
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }
  }

  /**
   * Disconnects the control session gracefully.
   */
  public disconnect(): void {
    this.isExplicitlyDisconnecting = true;
    this.stopHeartbeatLoop();

    if (this.socket && !this.socket.destroyed) {
      try {
        const disconnectMsg = createDisconnectRequestMessage({
          reason: "USER_REQUESTED",
          message: "User initiated disconnect from Windows client",
        });
        const frame = encodeFrame(disconnectMsg);
        this.socket.write(frame, () => {
          this.cleanupSocket();
        });
      } catch {
        this.cleanupSocket();
      }
    } else {
      this.cleanupSocket();
    }

    this.updateState({
      state: ConnectionState.DISCONNECTED,
      sessionId: null,
      sessionStartTime: 0,
      latencyMs: 0,
      errorMessage: null,
    });
    this.log("INFO", "Phone disconnected.");
  }
}
