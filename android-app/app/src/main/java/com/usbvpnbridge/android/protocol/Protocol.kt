package com.usbvpnbridge.android.protocol

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * USB VPN Bridge - Shared Communication Protocol Specification (v1.0)
 * Mirrored Kotlin Definitions for Android.
 */

object ProtocolConstants {
    const val PROTOCOL_VERSION = "1.0"
    const val MAX_MESSAGE_SIZE = 65536
    const val DEFAULT_CONTROL_PORT = 10809
    const val DEFAULT_DATA_PORT = 10808
}

enum class MessageType {
    HELLO,
    HELLO_ACK,
    DEVICE_INFO,
    STATUS,
    CONNECT_REQUEST,
    CONNECT_RESPONSE,
    DISCONNECT_REQUEST,
    HEARTBEAT,
    ERROR
}

enum class ConnectionState {
    DISCONNECTED,
    DEVICE_DETECTED,
    HANDSHAKING,
    CONNECTED_IDLE,
    STARTING_TETHER,
    TETHERING_ACTIVE,
    STOPPING_TETHER,
    ERROR_STATE,
    RECONNECTING
}

enum class NetModStatus {
    NOT_VERIFIED,
    NOT_INSTALLED,
    STOPPED,
    RUNNING_NO_VPN,
    ACTIVE_VPN,
    ACTIVE_PROXY_TETHER
}

enum class ErrorCode {
    ERR_VERSION_MISMATCH,
    ERR_UNAUTHORIZED,
    ERR_SERVICE_NOT_RUNNING,
    ERR_PORT_IN_USE,
    ERR_NETMOD_NOT_DETECTED,
    ERR_NETMOD_DISCONNECTED,
    ERR_TIMEOUT,
    ERR_INVALID_MESSAGE,
    ERR_FRAME_TOO_LARGE,
    ERR_INTERNAL
}

data class ControlEnvelope<T>(
    val version: String = ProtocolConstants.PROTOCOL_VERSION,
    val id: String,
    val type: MessageType,
    val timestamp: Long = System.currentTimeMillis(),
    val payload: T
)

data class HelloPayload(
    val protocolVersion: String,
    val clientId: String,
    val clientType: String,
    val clientVersion: String,
    val capabilities: List<String>
)

data class HelloAckPayload(
    val protocolVersion: String,
    val sessionId: String,
    val serverVersion: String,
    val serverCapabilities: List<String>,
    val accepted: Boolean,
    val rejectionReason: String? = null
)

data class DeviceInfoPayload(
    val model: String,
    val manufacturer: String,
    val osVersion: String,
    val apiLevel: Int,
    val batteryLevel: Int? = null,
    val isCharging: Boolean? = null,
    val netModInstalled: Boolean,
    val netModVersion: String? = null,
    val vpnActive: Boolean? = null
)

data class StatusPayload(
    val connectionState: ConnectionState,
    val netModStatus: NetModStatus,
    val bytesReceived: Long,
    val bytesSent: Long,
    val speedDownloadBps: Long,
    val speedUploadBps: Long,
    val activeSockets: Int,
    val uptimeSeconds: Long,
    val relayPort: Int
)

data class ConnectRequestPayload(
    val requestedDataPort: Int,
    val enableUdp: Boolean,
    val enableDnsProxy: Boolean,
    val clientTimestamp: Long
)

data class ConnectResponsePayload(
    val success: Boolean,
    val assignedDataPort: Int,
    val netModRouted: Boolean,
    val egressIp: String? = null,
    val errorMessage: String? = null,
    val errorCode: ErrorCode? = null
)

data class DisconnectRequestPayload(
    val reason: String,
    val message: String? = null
)

data class HeartbeatPayload(
    val sequence: Long,
    val senderTimestamp: Long,
    val replyTimestamp: Long? = null,
    val bytesReceived: Long? = null,
    val bytesSent: Long? = null,
    val speedDownloadBps: Long? = null,
    val speedUploadBps: Long? = null,
    val activeSockets: Int? = null
)

data class ErrorPayload(
    val code: ErrorCode,
    val message: String,
    val recoverable: Boolean
)

/**
 * Protocol framing utilities for 4-byte big-endian length prefix.
 */
object ProtocolFraming {
    val gson: Gson = GsonBuilder().create()

    fun <T> encodeFrame(envelope: ControlEnvelope<T>): ByteArray {
        val jsonBytes = gson.toJson(envelope).toByteArray(Charsets.UTF_8)
        if (jsonBytes.size > ProtocolConstants.MAX_MESSAGE_SIZE) {
            throw IllegalArgumentException(
                "Payload size (${jsonBytes.size} bytes) exceeds limit of ${ProtocolConstants.MAX_MESSAGE_SIZE}"
            )
        }

        val frame = ByteBuffer.allocate(4 + jsonBytes.size)
        frame.order(ByteOrder.BIG_ENDIAN)
        frame.putInt(jsonBytes.size)
        frame.put(jsonBytes)
        return frame.array()
    }
}

/**
 * Stream deframer for incoming TCP stream bytes.
 */
class StreamDeframer {
    private var buffer = ByteArray(0)

    @Synchronized
    fun push(chunk: ByteArray): List<ParsedFrame> {
        val combined = ByteArray(buffer.size + chunk.size)
        System.arraycopy(buffer, 0, combined, 0, buffer.size)
        System.arraycopy(chunk, 0, combined, buffer.size, chunk.size)
        buffer = combined

        val frames = mutableListOf<ParsedFrame>()

        while (buffer.size >= 4) {
            val lengthHeader = ByteBuffer.wrap(buffer, 0, 4).order(ByteOrder.BIG_ENDIAN).int
            if (lengthHeader < 0 || lengthHeader > ProtocolConstants.MAX_MESSAGE_SIZE) {
                // Invalid or oversized length, reset buffer
                buffer = ByteArray(0)
                throw IllegalArgumentException("Oversized frame header: $lengthHeader bytes")
            }

            val totalFrameSize = 4 + lengthHeader
            if (buffer.size < totalFrameSize) {
                // Incomplete frame, wait for more chunks
                break
            }

            val payloadBytes = ByteArray(lengthHeader)
            System.arraycopy(buffer, 4, payloadBytes, 0, lengthHeader)

            val remainingSize = buffer.size - totalFrameSize
            val newBuffer = ByteArray(remainingSize)
            System.arraycopy(buffer, totalFrameSize, newBuffer, 0, remainingSize)
            buffer = newBuffer

            val jsonStr = String(payloadBytes, Charsets.UTF_8)
            val jsonObject = JsonParser.parseString(jsonStr).asJsonObject
            val typeStr = jsonObject.get("type").asString
            val type = MessageType.valueOf(typeStr)
            val id = jsonObject.get("id").asString
            val version = jsonObject.get("version").asString
            val timestamp = jsonObject.get("timestamp").asLong
            val payload = jsonObject.getAsJsonObject("payload")

            frames.add(ParsedFrame(version, id, type, timestamp, payload))
        }

        return frames
    }

    @Synchronized
    fun reset() {
        buffer = ByteArray(0)
    }
}

data class ParsedFrame(
    val version: String,
    val id: String,
    val type: MessageType,
    val timestamp: Long,
    val payload: JsonObject
)
