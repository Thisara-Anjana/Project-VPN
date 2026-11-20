import net from "node:net";
import os from "node:os";
import {
  encodeFrame,
  StreamDeframer,
  createHelloMessage,
  createHeartbeatMessage,
  createDisconnectRequestMessage,
  MessageType,
  PROTOCOL_VERSION
} from "../shared-protocol/dist/index.js";

const HOST = "127.0.0.1";
const PORT = 10809;

console.log("=== Testing Real-Time Connectivity Indicators (Sub-Phase 4.1) ===");

const socket = new net.Socket();
const deframer = new StreamDeframer();
let sessionId = null;
let heartbeatTimer = null;
let seq = 0;

socket.connect(PORT, HOST, () => {
  console.log(`[CONNECTING -> AMBER] TCP socket opened to ${HOST}:${PORT}`);
  const pcHostName = os.hostname();
  console.log(`Sending HELLO frame with verified Windows hostname: "${pcHostName}"...`);
  const helloMsg = createHelloMessage({
    protocolVersion: PROTOCOL_VERSION,
    clientId: pcHostName,
    clientType: "WINDOWS_CLIENT",
    clientVersion: "1.0.0",
    capabilities: ["CONTROL_V1", "HEARTBEAT_V1", "DEVICE_INFO_V1", "SOCKS5_DATA_V1"],
  });
  socket.write(encodeFrame(helloMsg));
});

socket.on("data", (chunk) => {
  const frames = deframer.push(chunk);
  for (const frame of frames) {
    if (frame.type === MessageType.HELLO_ACK) {
      sessionId = frame.payload.sessionId;
      console.log(`[CONNECTED -> GREEN] HELLO_ACK accepted! Session: ${sessionId}`);
      console.log(`[STATE] Android Indicator: GREEN (PC Connected, PC: ${os.hostname()})`);
      console.log(`[STATE] Windows Indicator: GREEN (Phone Connected)`);

      // Send 3 heartbeats over 4.5 seconds to observe live session
      heartbeatTimer = setInterval(() => {
        seq++;
        const hb = createHeartbeatMessage({
          sequence: seq,
          senderTimestamp: Date.now()
        });
        socket.write(encodeFrame(hb));
      }, 1500);

      setTimeout(() => {
        clearInterval(heartbeatTimer);
        console.log("\n[TEST 5: Graceful PC Disconnect]");
        console.log("Sending DISCONNECT_REQUEST to Android...");
        const disc = createDisconnectRequestMessage({
          reason: "USER_REQUESTED",
          message: "User initiated disconnect test"
        });
        socket.write(encodeFrame(disc), () => {
          socket.destroy();
          console.log("[PASS] Windows socket destroyed.");
          console.log("[STATE] Android Indicator expected: RED (PC Disconnected)");
          process.exit(0);
        });
      }, 5000);
    } else if (frame.type === MessageType.DEVICE_INFO) {
      console.log(`[DEVICE_INFO] Model: ${frame.payload.model}, Manufacturer: ${frame.payload.manufacturer}, VPN Active: ${frame.payload.vpnActive}`);
    } else if (frame.type === MessageType.HEARTBEAT) {
      const rtt = Date.now() - frame.payload.senderTimestamp;
      console.log(`[HEARTBEAT #seq=${frame.payload.sequence}] Alive ACK received, RTT: ${rtt}ms`);
    }
  }
});

socket.on("error", (err) => {
  console.error(`Socket error: ${err.message}`);
});

socket.on("close", () => {
  console.log("Socket closed.");
});
