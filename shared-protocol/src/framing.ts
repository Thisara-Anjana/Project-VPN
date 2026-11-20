import { ControlEnvelope, MAX_MESSAGE_SIZE, ErrorCode } from "./protocol.js";

/**
 * Encodes a ControlEnvelope into a framed binary buffer.
 * Frame format: [4 bytes uint32 Big-Endian length][UTF-8 JSON bytes]
 */
export function encodeFrame(envelope: ControlEnvelope): Buffer {
  const jsonStr = JSON.stringify(envelope);
  const payloadBuf = Buffer.from(jsonStr, "utf8");

  if (payloadBuf.length > MAX_MESSAGE_SIZE) {
    throw new Error(
      `Payload size (${payloadBuf.length} bytes) exceeds maximum permitted size of ${MAX_MESSAGE_SIZE} bytes [${ErrorCode.ERR_FRAME_TOO_LARGE}]`
    );
  }

  const frame = Buffer.allocUnsafe(4 + payloadBuf.length);
  frame.writeUInt32BE(payloadBuf.length, 0);
  payloadBuf.copy(frame, 4);
  return frame;
}

/**
 * Stream deframer for decoding length-prefixed TCP frames.
 * Safe against fragmentation, concatenation, and memory exhaustion.
 */
export class StreamDeframer {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Pushes incoming raw network bytes into the deframer buffer.
   * Returns an array of parsed ControlEnvelopes if any complete frames arrived.
   */
  public push(chunk: Buffer): ControlEnvelope[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: ControlEnvelope[] = [];

    while (this.buffer.length >= 4) {
      const payloadLength = this.buffer.readUInt32BE(0);

      if (payloadLength > MAX_MESSAGE_SIZE) {
        // Discard buffer to prevent DoS memory buildup and throw error
        this.buffer = Buffer.alloc(0);
        throw new Error(
          `Incoming frame header indicates size of ${payloadLength} bytes, exceeding maximum limit of ${MAX_MESSAGE_SIZE} bytes [${ErrorCode.ERR_FRAME_TOO_LARGE}]`
        );
      }

      const totalFrameLength = 4 + payloadLength;
      if (this.buffer.length < totalFrameLength) {
        // Incomplete frame, wait for more chunks
        break;
      }

      // Complete frame extracted
      const payloadSlice = this.buffer.subarray(4, totalFrameLength);
      this.buffer = this.buffer.subarray(totalFrameLength);

      try {
        const jsonStr = payloadSlice.toString("utf8");
        const parsed = JSON.parse(jsonStr) as ControlEnvelope;
        messages.push(parsed);
      } catch (err) {
        throw new Error(
          `Failed to parse message JSON payload: ${err instanceof Error ? err.message : String(err)} [${ErrorCode.ERR_INVALID_MESSAGE}]`
        );
      }
    }

    return messages;
  }

  /**
   * Current unparsed bytes remaining in the buffer.
   */
  public get bufferedBytes(): number {
    return this.buffer.length;
  }

  /**
   * Resets internal buffer state.
   */
  public reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
