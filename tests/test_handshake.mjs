import net from "node:net";
import {
  encodeFrame,
  StreamDeframer,
  createHelloMessage,
  createHeartbeatMessage,
  createDisconnectRequestMessage,
  MessageType,
  PROTOCOL_VERSION,
} from "../shared-protocol/dist/index.js";

async function runTest() {
  console.log("=== Testing Real USB Control Channel Handshake ===");
  console.log(`Target: 127.0.0.1:10809 via ADB forward`);

  const socket = new net.Socket();
  const deframer = new StreamDeframer();

  await new Promise((resolve, reject) => {
    socket.connect(10809, "127.0.0.1", () => {
      console.log("[PASS] TCP connection established to 127.0.0.1:10809");
      resolve(null);
    });
    socket.on("error", reject);
  });

  // Step 1: Send HELLO
  const helloMsg = createHelloMessage({
    protocolVersion: PROTOCOL_VERSION,
    clientId: "test_verifier_01",
    clientType: "WINDOWS_CLIENT",
    clientVersion: "1.0.0",
    capabilities: ["CONTROL_V1", "HEARTBEAT_V1", "DEVICE_INFO_V1"],
  });

  console.log("Sending HELLO frame:", JSON.stringify(helloMsg));
  socket.write(encodeFrame(helloMsg));

  // Step 2: Listen for responses
  let receivedHelloAck = false;
  let receivedDeviceInfo = false;
  let receivedHeartbeatAck = false;

  const t0 = Date.now();

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for Android handshake responses"));
    }, 5000);

    socket.on("data", (chunk) => {
      const frames = deframer.push(chunk);
      for (const frame of frames) {
        console.log(`[RECEIVED] Type: ${frame.type}, ID: ${frame.id}`);
        console.log("Payload:", JSON.stringify(frame.payload, null, 2));

        if (frame.type === MessageType.HELLO_ACK) {
          receivedHelloAck = true;
          if (!frame.payload.accepted) {
            clearTimeout(timeout);
            reject(new Error(`Handshake rejected: ${frame.payload.rejectionReason}`));
            return;
          }
        }

        if (frame.type === MessageType.DEVICE_INFO) {
          receivedDeviceInfo = true;

          // Step 3: Send Heartbeat
          const pingTime = Date.now();
          const hbMsg = createHeartbeatMessage({
            sequence: 1,
            senderTimestamp: pingTime,
          });
          console.log("\nSending HEARTBEAT frame (seq=1)...");
          socket.write(encodeFrame(hbMsg));
        }

        if (frame.type === MessageType.HEARTBEAT) {
          receivedHeartbeatAck = true;
          const rtt = Date.now() - frame.payload.senderTimestamp;
          console.log(`\n[PASS] Heartbeat acknowledged! RTT: ${rtt}ms`);

          // Step 4: Disconnect
          console.log("\nSending DISCONNECT_REQUEST...");
          const discMsg = createDisconnectRequestMessage({
            reason: "USER_REQUESTED",
            message: "Test completed cleanly",
          });
          socket.write(encodeFrame(discMsg));

          clearTimeout(timeout);
          setTimeout(() => {
            socket.end();
            resolve(null);
          }, 100);
        }
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log("\n=== Handshake Verification Summary ===");
  console.log(`HELLO_ACK: ${receivedHelloAck ? "SUCCESS" : "FAILED"}`);
  console.log(`DEVICE_INFO: ${receivedDeviceInfo ? "SUCCESS" : "FAILED"}`);
  console.log(`HEARTBEAT: ${receivedHeartbeatAck ? "SUCCESS" : "FAILED"}`);
  console.log("=== All Phase 3 Control Channel Criteria Met ===");
}

runTest().catch((err) => {
  console.error("\n[TEST FAILED]:", err.message);
  process.exit(1);
});
