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

async function testHeartbeatStream() {
  console.log("=== Testing Continuous Heartbeat & Keep-Alive Stream ===");
  const socket = new net.Socket();
  const deframer = new StreamDeframer();

  await new Promise((resolve, reject) => {
    socket.connect(10809, "127.0.0.1", resolve);
    socket.on("error", reject);
  });

  // Send HELLO
  const helloMsg = createHelloMessage({
    protocolVersion: PROTOCOL_VERSION,
    clientId: "win_heartbeat_tester",
    clientType: "WINDOWS_CLIENT",
    clientVersion: "1.0.0",
    capabilities: ["CONTROL_V1", "HEARTBEAT_V1"],
  });
  socket.write(encodeFrame(helloMsg));

  let heartbeatsSent = 0;
  let heartbeatsReceived = 0;
  const latencies = [];

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout during heartbeat loop"));
    }, 10000);

    socket.on("data", (chunk) => {
      const frames = deframer.push(chunk);
      for (const frame of frames) {
        if (frame.type === MessageType.HELLO_ACK) {
          console.log("[OK] HELLO_ACK received. Starting 5 consecutive heartbeats...");
          sendNextHeartbeat();
        } else if (frame.type === MessageType.HEARTBEAT) {
          heartbeatsReceived++;
          const rtt = Date.now() - frame.payload.senderTimestamp;
          latencies.push(rtt);
          console.log(`[HB #${frame.payload.sequence}] Ack received, RTT: ${rtt}ms`);

          if (heartbeatsSent < 5) {
            setTimeout(sendNextHeartbeat, 300);
          } else {
            console.log("\n[OK] Completed 5 heartbeats successfully.");
            socket.write(
              encodeFrame(
                createDisconnectRequestMessage({
                  reason: "USER_REQUESTED",
                  message: "Heartbeat test finished",
                })
              )
            );
            clearTimeout(timeout);
            setTimeout(() => {
              socket.end();
              resolve(null);
            }, 100);
          }
        }
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    function sendNextHeartbeat() {
      heartbeatsSent++;
      const pingTime = Date.now();
      const hb = createHeartbeatMessage({
        sequence: heartbeatsSent,
        senderTimestamp: pingTime,
      });
      socket.write(encodeFrame(hb));
    }
  });

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`Average Latency: ${avgLatency.toFixed(2)}ms`);
  console.log("=== Heartbeat Loop Verified ===");
}

testHeartbeatStream().catch((err) => {
  console.error("Test failed:", err.message);
  process.exit(1);
});
