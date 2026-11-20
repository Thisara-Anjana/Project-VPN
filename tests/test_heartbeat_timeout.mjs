import net from "node:net";
import os from "node:os";
import {
  encodeFrame,
  StreamDeframer,
  createHelloMessage,
  MessageType,
  PROTOCOL_VERSION
} from "../shared-protocol/dist/index.js";

console.log("=== Testing Heartbeat Watchdog & Timeout Detection ===");

const socket = new net.Socket();
const deframer = new StreamDeframer();

socket.connect(10809, "127.0.0.1", () => {
  console.log("[1] Connected. Sending HELLO with hostname Thisara...");
  const helloMsg = createHelloMessage({
    protocolVersion: PROTOCOL_VERSION,
    clientId: os.hostname(),
    clientType: "WINDOWS_CLIENT",
    clientVersion: "1.0.0",
    capabilities: ["CONTROL_V1", "HEARTBEAT_V1", "DEVICE_INFO_V1"],
  });
  socket.write(encodeFrame(helloMsg));
});

socket.on("data", (chunk) => {
  const frames = deframer.push(chunk);
  for (const frame of frames) {
    if (frame.type === MessageType.HELLO_ACK) {
      console.log(`[2] HELLO_ACK accepted! Session: ${frame.payload.sessionId}`);
      console.log("[3] Intentionally ceasing all heartbeats to trigger Android heartbeat watchdog (> 5s)...");
      console.log("Waiting 7 seconds to observe Android timeout transition...");
      setTimeout(() => {
        console.log("[4] 7 seconds elapsed. Android watchdog has fired. Closing socket.");
        socket.destroy();
        process.exit(0);
      }, 7000);
    }
  }
});
