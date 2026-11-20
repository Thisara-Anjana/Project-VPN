package com.usbvpnbridge.android.service

import com.usbvpnbridge.android.protocol.ConnectionState
import com.usbvpnbridge.android.protocol.NetModStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class PcConnectionStatus {
    SERVICE_STOPPED,    // GRAY circle: "USB Service Stopped"
    CONNECTING,         // AMBER circle: "Connecting to PC"
    CONNECTED,          // GREEN circle: "PC Connected"
    DISCONNECTED        // RED circle: "PC Disconnected"
}

data class LogEntry(
    val timestamp: Long = System.currentTimeMillis(),
    val message: String
)

data class ServiceState(
    val isRunning: Boolean = false,
    val isProxyRunning: Boolean = false,
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val pcStatus: PcConnectionStatus = PcConnectionStatus.SERVICE_STOPPED,
    val connectedPcName: String? = null,
    val sessionStartMs: Long = 0L,
    val lastHeartbeatMs: Long = 0L,
    val statusDescription: String = "Start the USB service on Android to accept Windows connections.",
    val netModStatus: NetModStatus = NetModStatus.NOT_VERIFIED,
    val statusText: String = "Service Stopped",
    val clientConnected: Boolean = false,
    val activeSockets: Int = 0,
    val totalBytesSent: Long = 0,
    val totalBytesReceived: Long = 0,
    val uploadSpeedBps: Long = 0,
    val downloadSpeedBps: Long = 0,
    val isNetModInstalled: Boolean = false,
    val isVpnActive: Boolean = false,
    val thermalStatus: String = "Normal",
    val error: String? = null
)

object ServiceStateHolder {
    private val _state = MutableStateFlow(ServiceState())
    val state: StateFlow<ServiceState> = _state.asStateFlow()

    private val _logs = MutableStateFlow<List<LogEntry>>(listOf(LogEntry(message = "App initialized.")))
    val logs: StateFlow<List<LogEntry>> = _logs.asStateFlow()

    fun logActivity(message: String) {
        val current = _logs.value.toMutableList()
        current.add(LogEntry(message = message))
        if (current.size > 100) {
            current.removeAt(0)
        }
        _logs.value = current
    }

    fun clearLogs() {
        _logs.value = emptyList()
    }

    fun updateState(updater: (ServiceState) -> ServiceState) {
        _state.value = updater(_state.value)
    }

    fun setServiceStopped() {
        _state.value = _state.value.copy(
            isRunning = false,
            isProxyRunning = false,
            connectionState = ConnectionState.DISCONNECTED,
            pcStatus = PcConnectionStatus.SERVICE_STOPPED,
            connectedPcName = null,
            sessionStartMs = 0L,
            lastHeartbeatMs = 0L,
            clientConnected = false,
            statusText = "Service Stopped",
            statusDescription = "Start the USB service on Android to accept Windows connections.",
            error = null
        )
    }

    fun setServiceRunning(description: String) {
        _state.value = _state.value.copy(
            isRunning = true,
            isProxyRunning = true,
            connectionState = ConnectionState.DEVICE_DETECTED,
            pcStatus = PcConnectionStatus.DISCONNECTED,
            connectedPcName = null,
            sessionStartMs = 0L,
            lastHeartbeatMs = 0L,
            clientConnected = false,
            statusText = "Listening",
            statusDescription = description,
            error = null
        )
    }

    fun setPcConnecting(description: String) {
        _state.value = _state.value.copy(
            connectionState = ConnectionState.HANDSHAKING,
            pcStatus = PcConnectionStatus.CONNECTING,
            statusText = "Handshaking",
            statusDescription = description
        )
    }

    fun setPcConnected(pcName: String?, description: String) {
        val now = System.currentTimeMillis()
        _state.value = _state.value.copy(
            connectionState = ConnectionState.CONNECTED_IDLE,
            pcStatus = PcConnectionStatus.CONNECTED,
            connectedPcName = pcName,
            sessionStartMs = now,
            lastHeartbeatMs = now,
            clientConnected = true,
            statusText = "PC Connected",
            statusDescription = description,
            error = null
        )
    }

    fun updateHeartbeat() {
        _state.value = _state.value.copy(
            lastHeartbeatMs = System.currentTimeMillis()
        )
    }

    fun setPcDisconnected(description: String) {
        _state.value = _state.value.copy(
            connectionState = if (_state.value.isRunning) ConnectionState.DEVICE_DETECTED else ConnectionState.DISCONNECTED,
            pcStatus = if (_state.value.isRunning) PcConnectionStatus.DISCONNECTED else PcConnectionStatus.SERVICE_STOPPED,
            connectedPcName = null,
            sessionStartMs = 0L,
            clientConnected = false,
            statusText = if (_state.value.isRunning) "Waiting for PC" else "Service Stopped",
            statusDescription = description
        )
    }

    fun updateTelemetry(
        activeSockets: Int,
        bytesSent: Long,
        bytesReceived: Long,
        uploadSpeedBps: Long,
        downloadSpeedBps: Long
    ) {
        _state.value = _state.value.copy(
            activeSockets = activeSockets,
            totalBytesSent = bytesSent,
            totalBytesReceived = bytesReceived,
            uploadSpeedBps = uploadSpeedBps,
            downloadSpeedBps = downloadSpeedBps
        )
    }

    fun updateNetModStatus(isInstalled: Boolean, isVpnActive: Boolean) {
        val status = when {
            isInstalled && isVpnActive -> NetModStatus.ACTIVE_VPN
            isInstalled && !isVpnActive -> NetModStatus.RUNNING_NO_VPN
            else -> NetModStatus.NOT_INSTALLED
        }
        _state.value = _state.value.copy(
            isNetModInstalled = isInstalled,
            isVpnActive = isVpnActive,
            netModStatus = status
        )
    }

    fun updateThermalStatus(status: String) {
        _state.value = _state.value.copy(thermalStatus = status)
    }

    fun setError(errorMsg: String) {
        _state.value = _state.value.copy(
            connectionState = ConnectionState.ERROR_STATE,
            statusText = "Error",
            statusDescription = errorMsg,
            error = errorMsg
        )
    }
}
