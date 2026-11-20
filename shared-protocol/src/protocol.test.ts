import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MessageType,
  ConnectionState,
  NetModStatus,
  ErrorCode,
  PROTOCOL_VERSION,
  MAX_MESSAGE_SIZE,
} from "./protocol.js";
import { encodeFrame, StreamDeframer } from "./framing.js";
import {
  createHelloMessage,
  createHelloAckMessage,
  createDeviceInfoMessage,
  createStatusMessage,
  createHeartbeatMessage,
  createErrorMessage,
  isValidEnvelope,
} from "./messages.js";

describe("Shared Protocol - Framing & Serialization", () => {
  it("should encode and decode a HELLO message correctly", () => {
    const hello = createHelloMessage({
      protocolVersion: PROTOCOL_VERSION,
      clientId: "win_client_test",
      clientType: "WINDOWS_CLIENT",
      clientVersion: "1.0.0",
      capabilities: ["SOCKS5", "UDP", "METRICS_V1"],
    });

    assert.ok(isValidEnvelope(hello));
    assert.equal(hello.type, MessageType.HELLO);

    const frame = encodeFrame(hello);
    assert.ok(frame.length > 4);

    const lengthHeader = frame.readUInt32BE(0);
    assert.equal(lengthHeader, frame.length - 4);

    const deframer = new StreamDeframer();
    const parsedMessages = deframer.push(frame);

    assert.equal(parsedMessages.length, 1);
    const decoded = parsedMessages[0];
    assert.equal(decoded.id, hello.id);
    assert.equal(decoded.type, MessageType.HELLO);
    assert.deepEqual(decoded.payload, hello.payload);
  });

  it("should handle TCP stream fragmentation gracefully", () => {
    const statusMsg = createStatusMessage({
      connectionState: ConnectionState.TETHERING_ACTIVE,
      netModStatus: NetModStatus.ACTIVE_VPN,
      bytesReceived: 1048576,
      bytesSent: 524288,
      speedDownloadBps: 25000000,
      speedUploadBps: 5000000,
      activeSockets: 14,
      uptimeSeconds: 120,
      relayPort: 10808,
    });

    const frame = encodeFrame(statusMsg);
    const deframer = new StreamDeframer();

    // Split frame into 3 arbitrary slices simulating network chunks
    const chunk1 = frame.subarray(0, 10);
    const chunk2 = frame.subarray(10, 50);
    const chunk3 = frame.subarray(50);

    const res1 = deframer.push(chunk1);
    assert.equal(res1.length, 0);
    assert.equal(deframer.bufferedBytes, 10);

    const res2 = deframer.push(chunk2);
    assert.equal(res2.length, 0);
    assert.equal(deframer.bufferedBytes, 50);

    const res3 = deframer.push(chunk3);
    assert.equal(res3.length, 1);
    assert.equal(deframer.bufferedBytes, 0);

    assert.equal(res3[0].type, MessageType.STATUS);
    assert.equal((res3[0].payload as any).bytesReceived, 1048576);
  });

  it("should handle multiple frames concatenated in a single TCP chunk", () => {
    const hb1 = createHeartbeatMessage({ sequence: 1, senderTimestamp: 1000 });
    const hb2 = createHeartbeatMessage({ sequence: 2, senderTimestamp: 2000 });
    const hb3 = createHeartbeatMessage({ sequence: 3, senderTimestamp: 3000 });

    const frame1 = encodeFrame(hb1);
    const frame2 = encodeFrame(hb2);
    const frame3 = encodeFrame(hb3);

    const combined = Buffer.concat([frame1, frame2, frame3]);
    const deframer = new StreamDeframer();

    const parsed = deframer.push(combined);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].type, MessageType.HEARTBEAT);
    assert.equal((parsed[0].payload as any).sequence, 1);
    assert.equal((parsed[1].payload as any).sequence, 2);
    assert.equal((parsed[2].payload as any).sequence, 3);
    assert.equal(deframer.bufferedBytes, 0);
  });

  it("should enforce MAX_MESSAGE_SIZE and reject oversized payloads", () => {
    const hugeString = "X".repeat(MAX_MESSAGE_SIZE + 100);
    const oversizedMsg = createErrorMessage({
      code: ErrorCode.ERR_INTERNAL,
      message: hugeString,
      recoverable: false,
    });

    assert.throws(
      () => {
        encodeFrame(oversizedMsg);
      },
      (err: Error) => {
        return err.message.includes("exceeds maximum permitted size");
      }
    );
  });

  it("should reject corrupted or invalid length headers", () => {
    const fakeHeader = Buffer.alloc(4);
    fakeHeader.writeUInt32BE(999999, 0); // Exceeds MAX_MESSAGE_SIZE (65536)

    const deframer = new StreamDeframer();
    assert.throws(
      () => {
        deframer.push(fakeHeader);
      },
      (err: Error) => {
        return err.message.includes("exceeding maximum limit");
      }
    );
    assert.equal(deframer.bufferedBytes, 0); // Buffer reset on violation
  });

  it("should validate envelopes accurately", () => {
    assert.equal(isValidEnvelope(null), false);
    assert.equal(isValidEnvelope({}), false);
    assert.equal(isValidEnvelope({ type: "UNKNOWN_TYPE" }), false);
    assert.equal(
      isValidEnvelope({
        version: "1.0",
        id: "test",
        type: MessageType.DEVICE_INFO,
        timestamp: Date.now(),
        payload: {},
      }),
      true
    );
  });
});
