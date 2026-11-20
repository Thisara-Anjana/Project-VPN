import {
  ControlEnvelope,
  MessageType,
  PROTOCOL_VERSION,
  HelloPayload,
  HelloAckPayload,
  DeviceInfoPayload,
  StatusPayload,
  ConnectRequestPayload,
  ConnectResponsePayload,
  DisconnectRequestPayload,
  HeartbeatPayload,
  ErrorPayload,
  ErrorCode,
} from "./protocol.js";

function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `msg_${timestamp}_${randomPart}`;
}

export function createEnvelope<T>(type: MessageType, payload: T, id?: string): ControlEnvelope<T> {
  return {
    version: PROTOCOL_VERSION,
    id: id || generateMessageId(),
    type,
    timestamp: Date.now(),
    payload,
  };
}

export function createHelloMessage(payload: HelloPayload): ControlEnvelope<HelloPayload> {
  return createEnvelope(MessageType.HELLO, payload);
}

export function createHelloAckMessage(payload: HelloAckPayload, replyToId?: string): ControlEnvelope<HelloAckPayload> {
  return createEnvelope(MessageType.HELLO_ACK, payload, replyToId);
}

export function createDeviceInfoMessage(payload: DeviceInfoPayload): ControlEnvelope<DeviceInfoPayload> {
  return createEnvelope(MessageType.DEVICE_INFO, payload);
}

export function createStatusMessage(payload: StatusPayload): ControlEnvelope<StatusPayload> {
  return createEnvelope(MessageType.STATUS, payload);
}

export function createConnectRequestMessage(payload: ConnectRequestPayload): ControlEnvelope<ConnectRequestPayload> {
  return createEnvelope(MessageType.CONNECT_REQUEST, payload);
}

export function createConnectResponseMessage(
  payload: ConnectResponsePayload,
  replyToId?: string
): ControlEnvelope<ConnectResponsePayload> {
  return createEnvelope(MessageType.CONNECT_RESPONSE, payload, replyToId);
}

export function createDisconnectRequestMessage(
  payload: DisconnectRequestPayload
): ControlEnvelope<DisconnectRequestPayload> {
  return createEnvelope(MessageType.DISCONNECT_REQUEST, payload);
}

export function createHeartbeatMessage(payload: HeartbeatPayload): ControlEnvelope<HeartbeatPayload> {
  return createEnvelope(MessageType.HEARTBEAT, payload);
}

export function createErrorMessage(payload: ErrorPayload, replyToId?: string): ControlEnvelope<ErrorPayload> {
  return createEnvelope(MessageType.ERROR, payload, replyToId);
}

export function isValidEnvelope(obj: unknown): obj is ControlEnvelope {
  if (typeof obj !== "object" || obj === null) return false;
  const env = obj as Record<string, unknown>;
  return (
    typeof env.version === "string" &&
    typeof env.id === "string" &&
    typeof env.type === "string" &&
    Object.values(MessageType).includes(env.type as MessageType) &&
    typeof env.timestamp === "number" &&
    env.payload !== undefined
  );
}
