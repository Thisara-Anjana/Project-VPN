package com.usbvpnbridge.android

import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.usbvpnbridge.android.protocol.ConnectionState
import com.usbvpnbridge.android.protocol.NetModStatus
import com.usbvpnbridge.android.service.PcConnectionStatus
import com.usbvpnbridge.android.service.RelayForegroundService
import com.usbvpnbridge.android.service.ServiceStateHolder
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale

data class MainUiState(
    val deviceModel: String = "${Build.MANUFACTURER} ${Build.MODEL}",
    val manufacturer: String = Build.MANUFACTURER,
    val androidVersion: String = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
    val isServiceRunning: Boolean = false,
    val isProxyRunning: Boolean = false,
    val pcStatus: PcConnectionStatus = PcConnectionStatus.SERVICE_STOPPED,
    val pcStatusText: String = "USB Service Stopped",
    val pcName: String? = null,
    val connectionDurationText: String = "00:00",
    val lastHeartbeatText: String = "Inactive",
    val statusDescription: String = "Start the USB service on Android to accept Windows connections.",
    val usbStatusText: String = "Service Stopped",
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val isClientConnected: Boolean = false,
    val lastHeartbeatMs: Long = 0,
    val netModStatusText: String = "Not Verified",
    val netModStatus: NetModStatus = NetModStatus.NOT_VERIFIED,
    val activeSockets: Int = 0,
    val downloadSpeedText: String = "0.00 KB/s",
    val uploadSpeedText: String = "0.00 KB/s",
    val totalDataText: String = "0.00 MB",
    val netModInstalled: Boolean = false,
    val isVpnActive: Boolean = false,
    val thermalStatus: String = "Normal",
    val logs: List<com.usbvpnbridge.android.service.LogEntry> = emptyList()
)

class MainViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(MainUiState())
    val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()

    init {
        // Collect live service state updates
        viewModelScope.launch {
            ServiceStateHolder.state.collect {
                updateUiFromServiceState()
            }
        }

        // Collect activity logs
        viewModelScope.launch {
            ServiceStateHolder.logs.collect { newLogs ->
                _uiState.value = _uiState.value.copy(logs = newLogs)
            }
        }

        // Realtime second ticker: update duration and heartbeat timers smoothly
        viewModelScope.launch {
            while (isActive) {
                delay(1000)
                updateUiFromServiceState()
            }
        }
    }

    private fun updateUiFromServiceState() {
        val serviceState = ServiceStateHolder.state.value
        val dlSpeedKbps = serviceState.downloadSpeedBps / 8.0 / 1024.0
        val ulSpeedKbps = serviceState.uploadSpeedBps / 8.0 / 1024.0
        val totalMb = (serviceState.totalBytesReceived + serviceState.totalBytesSent) / (1024.0 * 1024.0)

        val netModText = when {
            serviceState.isNetModInstalled && serviceState.isVpnActive -> "Active VPN (tun0)"
            serviceState.isNetModInstalled && !serviceState.isVpnActive -> "Installed (VPN Idle)"
            else -> "Not Installed"
        }

        val pcStatusLabel = when (serviceState.pcStatus) {
            PcConnectionStatus.CONNECTED -> "PC Connected"
            PcConnectionStatus.CONNECTING -> "Connecting to PC"
            PcConnectionStatus.DISCONNECTED -> "PC Disconnected"
            PcConnectionStatus.SERVICE_STOPPED -> "USB Service Stopped"
        }

        val now = System.currentTimeMillis()
        val durationText = if (serviceState.pcStatus == PcConnectionStatus.CONNECTED && serviceState.sessionStartMs > 0) {
            val totalSec = (now - serviceState.sessionStartMs) / 1000
            val min = totalSec / 60
            val sec = totalSec % 60
            String.format(Locale.US, "%02d:%02d", min, sec)
        } else {
            "00:00"
        }

        val heartbeatText = if (serviceState.pcStatus == PcConnectionStatus.CONNECTED && serviceState.lastHeartbeatMs > 0) {
            val hbSecAgo = (now - serviceState.lastHeartbeatMs) / 1000
            if (hbSecAgo <= 1) "Just now" else "${hbSecAgo}s ago"
        } else if (serviceState.pcStatus == PcConnectionStatus.CONNECTING) {
            "Handshaking..."
        } else {
            "Inactive"
        }

        _uiState.value = _uiState.value.copy(
            isServiceRunning = serviceState.isRunning,
            isProxyRunning = serviceState.isProxyRunning,
            pcStatus = serviceState.pcStatus,
            pcStatusText = pcStatusLabel,
            pcName = serviceState.connectedPcName,
            connectionDurationText = durationText,
            lastHeartbeatText = heartbeatText,
            statusDescription = serviceState.statusDescription,
            usbStatusText = serviceState.statusText,
            connectionState = serviceState.connectionState,
            isClientConnected = serviceState.clientConnected,
            lastHeartbeatMs = serviceState.lastHeartbeatMs,
            activeSockets = serviceState.activeSockets,
            downloadSpeedText = String.format(Locale.US, "%.2f KB/s", dlSpeedKbps),
            uploadSpeedText = String.format(Locale.US, "%.2f KB/s", ulSpeedKbps),
            totalDataText = String.format(Locale.US, "%.2f MB", totalMb),
            netModStatusText = netModText,
            netModStatus = serviceState.netModStatus,
            netModInstalled = serviceState.isNetModInstalled,
            isVpnActive = serviceState.isVpnActive,
            thermalStatus = serviceState.thermalStatus
        )
    }

    fun clearLogs() {
        ServiceStateHolder.clearLogs()
    }

    fun checkDeviceEnvironment(context: Context) {
        val netModPackage = "com.netmod.syna"
        val isNetModInstalled = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(netModPackage, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(netModPackage, 0)
            }
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }

        val isVpnActive = try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val activeNet = cm.activeNetwork
            val caps = if (activeNet != null) cm.getNetworkCapabilities(activeNet) else null
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        } catch (e: Exception) {
            false
        }

        ServiceStateHolder.updateNetModStatus(isNetModInstalled, isVpnActive)
    }

    fun toggleService(context: Context) {
        if (_uiState.value.isServiceRunning) {
            RelayForegroundService.stop(context)
        } else {
            RelayForegroundService.start(context)
        }
    }
}
