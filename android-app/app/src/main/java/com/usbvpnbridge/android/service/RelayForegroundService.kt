package com.usbvpnbridge.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.usbvpnbridge.android.R
import com.usbvpnbridge.android.protocol.*
import com.usbvpnbridge.android.proxy.Socks5ProxyServer
import kotlinx.coroutines.*
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Android Foreground Service managing the USB TCP control and SOCKS5 data channels.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Standard Android Foreground Service, NOT a VpnService.
 * 2. Binds EXCLUSIVELY to loopback (127.0.0.1:10809 for Control, 127.0.0.1:10808 for SOCKS5 Data).
 * 3. Handles HELLO/HELLO_ACK, DEVICE_INFO, HEARTBEAT, and DISCONNECT_REQUEST over port 10809.
 * 4. Proxies TCP internet traffic via SOCKS5 over port 10808 using Android's network stack.
 * 5. Preserves NetMod VPN without disruption (zero VpnService conflict).
 */
class RelayForegroundService : Service() {

    companion object {
        private const val TAG = "RelayForegroundService"
        const val CHANNEL_ID = "usb_vpn_bridge_channel"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START_RELAY = "com.usbvpnbridge.action.START_RELAY"
        const val ACTION_STOP_RELAY = "com.usbvpnbridge.action.STOP_RELAY"

        fun start(context: Context) {
            val intent = Intent(context, RelayForegroundService::class.java).apply {
                action = ACTION_START_RELAY
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, RelayForegroundService::class.java).apply {
                action = ACTION_STOP_RELAY
            }
            context.stopService(intent)
        }
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var serverSocket: ServerSocket? = null
    private var activeClientSocket: Socket? = null
    private var clientJob: Job? = null
    private var socks5Proxy: Socks5ProxyServer? = null
    private var telemetryJob: Job? = null
    private var isNetModInstalled: Boolean = false
    private var wakeLock: PowerManager.WakeLock? = null
    private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        checkNetModInstalled()
        ServiceStateHolder.updateNetModStatus(isNetModInstalled, isVpnActive())

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "USBVPNBridge::RelayWakeLock")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                thermalListener = PowerManager.OnThermalStatusChangedListener { status ->
                    val label = when (status) {
                        PowerManager.THERMAL_STATUS_NONE -> "Normal"
                        PowerManager.THERMAL_STATUS_LIGHT -> "Light"
                        PowerManager.THERMAL_STATUS_MODERATE -> "Moderate"
                        PowerManager.THERMAL_STATUS_SEVERE -> "Severe (Throttling)"
                        PowerManager.THERMAL_STATUS_CRITICAL -> "Critical"
                        PowerManager.THERMAL_STATUS_EMERGENCY -> "Emergency"
                        PowerManager.THERMAL_STATUS_SHUTDOWN -> "Shutdown"
                        else -> "Unknown"
                    }
                    ServiceStateHolder.updateThermalStatus(label)
                    if (status >= PowerManager.THERMAL_STATUS_SEVERE) {
                        Log.w(TAG, "Device thermal status: $label")
                        ServiceStateHolder.logActivity("Warning: Device temperature high ($label)")
                    }
                }
                powerManager.addThermalStatusListener(thermalListener!!)
            } catch (e: Exception) {
                Log.w(TAG, "Could not register thermal listener: ${e.message}")
            }
        }
    }

    private fun acquireWakeLock() {
        try {
            if (wakeLock?.isHeld == false) {
                wakeLock?.acquire(12 * 60 * 60 * 1000L) // 12 hours max safety
                Log.i(TAG, "Acquired PARTIAL_WAKE_LOCK for screen-off USB tethering")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to acquire wake lock: ${e.message}")
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
                Log.i(TAG, "Released PARTIAL_WAKE_LOCK")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to release wake lock: ${e.message}")
        }
    }

    private fun checkNetModInstalled() {
        val netModPackage = "com.netmod.syna"
        isNetModInstalled = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(netModPackage, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(netModPackage, 0)
            }
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
    }

    private fun isVpnActive(): Boolean {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val activeNet = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(activeNet) ?: return false
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        } catch (e: Exception) {
            false
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_RELAY -> {
                Log.i(TAG, "Stopping relay service by intent request")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                Log.i(TAG, "Starting relay control & data services")
                startForegroundWithNotification("Relay Active (Control: 10809, SOCKS5: 10808)")
                acquireWakeLock()
                startControlListener()
                startSocks5Proxy()
                startTelemetryMonitor()
            }
        }
        return START_STICKY
    }

    private fun startSocks5Proxy() {
        if (socks5Proxy == null) {
            socks5Proxy = Socks5ProxyServer(ProtocolConstants.DEFAULT_DATA_PORT)
            socks5Proxy?.start(serviceScope)
            Log.i(TAG, "SOCKS5 Proxy started on 127.0.0.1:${ProtocolConstants.DEFAULT_DATA_PORT}")
        }
    }

    private fun startTelemetryMonitor() {
        telemetryJob?.cancel()
        telemetryJob = serviceScope.launch {
            var lastSent = 0L
            var lastRecv = 0L
            var lastTime = System.currentTimeMillis()

            while (isActive) {
                delay(1000)
                val now = System.currentTimeMillis()
                val elapsedSec = ((now - lastTime).coerceAtLeast(1)) / 1000.0

                val currentSent = socks5Proxy?.totalBytesSent?.get() ?: 0L
                val currentRecv = socks5Proxy?.totalBytesReceived?.get() ?: 0L
                val active = socks5Proxy?.activeSockets?.get() ?: 0

                val uploadSpeedBps = (((currentSent - lastSent) * 8) / elapsedSec).toLong()
                val downloadSpeedBps = (((currentRecv - lastRecv) * 8) / elapsedSec).toLong()

                lastSent = currentSent
                lastRecv = currentRecv
                lastTime = now

                // Heartbeat Watchdog: Check if active PC session timed out (> 25000ms)
                // Generous tolerance prevents spurious disconnects when Windows is minimized,
                // when apps switch, or during high-throughput TCP network traffic.
                if (ServiceStateHolder.state.value.pcStatus == PcConnectionStatus.CONNECTED) {
                    val lastHb = ServiceStateHolder.state.value.lastHeartbeatMs
                    val elapsedSinceHb = now - lastHb
                    if (lastHb > 0 && elapsedSinceHb > 25000) {
                        Log.w(TAG, "Heartbeat timeout! No heartbeat from Windows client for ${elapsedSinceHb}ms")
                        synchronized(this@RelayForegroundService) {
                            try { activeClientSocket?.close() } catch (_: Exception) {}
                            activeClientSocket = null
                        }
                        ServiceStateHolder.setPcDisconnected("Connection lost: Heartbeat timeout (> 25s).")
                        ServiceStateHolder.logActivity("Heartbeat timeout (> 25s). Connection lost.")
                        updateNotification("Connection Lost (Heartbeat Timeout)")
                    }
                }

                val vpnActive = isVpnActive()
                checkNetModInstalled()
                ServiceStateHolder.updateNetModStatus(isNetModInstalled, vpnActive)
                ServiceStateHolder.updateTelemetry(
                    activeSockets = active,
                    bytesSent = currentSent,
                    bytesReceived = currentRecv,
                    uploadSpeedBps = uploadSpeedBps,
                    downloadSpeedBps = downloadSpeedBps
                )
            }
        }
    }

    private fun startControlListener() {
        if (serverSocket != null && !serverSocket!!.isClosed) {
            Log.d(TAG, "Server socket is already running on port ${ProtocolConstants.DEFAULT_CONTROL_PORT}")
            return
        }

        serviceScope.launch(Dispatchers.IO) {
            try {
                // EXCLUSIVELY bind to loopback 127.0.0.1
                val loopbackAddress = InetAddress.getByName("127.0.0.1")
                serverSocket = ServerSocket(ProtocolConstants.DEFAULT_CONTROL_PORT, 5, loopbackAddress)
                Log.i(TAG, "Control channel listening on 127.0.0.1:${ProtocolConstants.DEFAULT_CONTROL_PORT}")
                ServiceStateHolder.setServiceRunning("Waiting for Windows client on 127.0.0.1:${ProtocolConstants.DEFAULT_CONTROL_PORT} via USB.")
                ServiceStateHolder.logActivity("USB Control listener started on port ${ProtocolConstants.DEFAULT_CONTROL_PORT}")

                while (isActive) {
                    try {
                        val client = serverSocket?.accept() ?: break
                        Log.i(TAG, "Incoming control connection from: ${client.remoteSocketAddress}")
                        ServiceStateHolder.setPcConnecting("TCP socket opened. Handshaking with Windows PC...")
                        ServiceStateHolder.logActivity("Incoming connection from Windows PC")

                        // Handle existing client: single active Windows control session model
                        synchronized(this@RelayForegroundService) {
                            try {
                                activeClientSocket?.close()
                            } catch (_: Exception) {}
                            clientJob?.cancel()
                            activeClientSocket = client
                        }

                        clientJob = serviceScope.launch(Dispatchers.IO) {
                            handleClientSession(client)
                        }
                    } catch (e: SocketException) {
                        if (!isActive) break
                        Log.w(TAG, "ServerSocket accept interrupted: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error starting control listener: ${e.message}", e)
                ServiceStateHolder.setError("Port ${ProtocolConstants.DEFAULT_CONTROL_PORT} unavailable: ${e.message}")
                ServiceStateHolder.logActivity("Control listener error: ${e.message}")
                updateNotification("Listener error: ${e.message}")
            }
        }
    }

    private suspend fun handleClientSession(socket: Socket) = withContext(Dispatchers.IO) {
        val deframer = StreamDeframer()
        val inStream: InputStream = socket.getInputStream()
        val outStream: OutputStream = socket.getOutputStream()
        val buffer = ByteArray(4096)

        try {
            updateNotification("Connecting to PC — Performing Handshake")

            while (isActive && !socket.isClosed) {
                val bytesRead = inStream.read(buffer)
                if (bytesRead == -1) {
                    Log.i(TAG, "Client closed connection (EOF)")
                    break
                }

                val chunk = ByteArray(bytesRead)
                System.arraycopy(buffer, 0, chunk, 0, bytesRead)

                val frames = try {
                    deframer.push(chunk)
                } catch (e: Exception) {
                    Log.e(TAG, "Deframing error: ${e.message}", e)
                    sendErrorFrame(outStream, ErrorCode.ERR_INVALID_MESSAGE, "Malformed message: ${e.message}", null)
                    break
                }

                for (frame in frames) {
                    processIncomingFrame(frame, outStream)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Client session terminated: ${e.message}")
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {}

            synchronized(this@RelayForegroundService) {
                if (activeClientSocket == socket) {
                    activeClientSocket = null
                }
            }

            Log.i(TAG, "PC control session disconnected")
            ServiceStateHolder.setPcDisconnected("Waiting for Windows client on 127.0.0.1:${ProtocolConstants.DEFAULT_CONTROL_PORT} via USB.")
            ServiceStateHolder.logActivity("PC control session disconnected")
            updateNotification("Waiting for Windows (127.0.0.1:${ProtocolConstants.DEFAULT_CONTROL_PORT})")
        }
    }

    private fun processIncomingFrame(frame: ParsedFrame, outStream: OutputStream) {
        if (frame.type != MessageType.HEARTBEAT) {
            Log.d(TAG, "Received frame: type=${frame.type}, id=${frame.id}")
        }

        when (frame.type) {
            MessageType.HELLO -> {
                val protocolVer = if (frame.payload.has("protocolVersion")) {
                    frame.payload.get("protocolVersion").asString
                } else "unknown"

                if (protocolVer != ProtocolConstants.PROTOCOL_VERSION) {
                    Log.w(TAG, "Protocol version mismatch: client=$protocolVer, server=${ProtocolConstants.PROTOCOL_VERSION}")
                    val ackPayload = HelloAckPayload(
                        protocolVersion = ProtocolConstants.PROTOCOL_VERSION,
                        sessionId = "",
                        serverVersion = "1.0.0",
                        serverCapabilities = listOf("CONTROL_V1", "SOCKS5_DATA_V1"),
                        accepted = false,
                        rejectionReason = "Protocol version mismatch. Expected ${ProtocolConstants.PROTOCOL_VERSION}, got $protocolVer"
                    )
                    val responseEnvelope = ControlEnvelope(
                        id = frame.id,
                        type = MessageType.HELLO_ACK,
                        payload = ackPayload
                    )
                    outStream.write(ProtocolFraming.encodeFrame(responseEnvelope))
                    outStream.flush()
                    return
                }

                // Send HELLO_ACK
                val sessionId = "session_${UUID.randomUUID().toString().substring(0, 8)}"
                val ackPayload = HelloAckPayload(
                    protocolVersion = ProtocolConstants.PROTOCOL_VERSION,
                    sessionId = sessionId,
                    serverVersion = "1.0.0",
                    serverCapabilities = listOf("CONTROL_V1", "HEARTBEAT_V1", "DEVICE_INFO_V1", "SOCKS5_DATA_V1"),
                    accepted = true
                )
                val responseEnvelope = ControlEnvelope(
                    id = frame.id,
                    type = MessageType.HELLO_ACK,
                    payload = ackPayload
                )
                outStream.write(ProtocolFraming.encodeFrame(responseEnvelope))
                outStream.flush()

                // Immediately transmit DEVICE_INFO
                sendDeviceInfo(outStream)

                val pcName = if (frame.payload.has("clientId")) {
                    val raw = frame.payload.get("clientId").asString
                    if (raw.startsWith("win_")) null else raw
                } else null

                Log.i(TAG, "PC control session connected (PC: ${pcName ?: "Windows PC"}, Session: $sessionId)")
                acquireWakeLock()
                ServiceStateHolder.setPcConnected(pcName, "Control session alive and healthy.")
                ServiceStateHolder.logActivity("Connected to ${pcName ?: "Windows PC"} (Session $sessionId)")
                updateNotification("Connected to ${pcName ?: "Windows PC"} (Session $sessionId)")
            }

            MessageType.DEVICE_INFO -> {
                sendDeviceInfo(outStream, frame.id)
            }

            MessageType.HEARTBEAT -> {
                val seq = if (frame.payload.has("sequence")) frame.payload.get("sequence").asLong else 0L
                val senderTime = if (frame.payload.has("senderTimestamp")) frame.payload.get("senderTimestamp").asLong else 0L
                val cur = ServiceStateHolder.state.value
                val hbPayload = HeartbeatPayload(
                    sequence = seq,
                    senderTimestamp = senderTime,
                    replyTimestamp = System.currentTimeMillis(),
                    bytesReceived = cur.totalBytesReceived,
                    bytesSent = cur.totalBytesSent,
                    speedDownloadBps = cur.downloadSpeedBps,
                    speedUploadBps = cur.uploadSpeedBps,
                    activeSockets = cur.activeSockets
                )
                val responseEnvelope = ControlEnvelope(
                    id = frame.id,
                    type = MessageType.HEARTBEAT,
                    payload = hbPayload
                )
                outStream.write(ProtocolFraming.encodeFrame(responseEnvelope))
                outStream.flush()
                ServiceStateHolder.updateHeartbeat()
            }

            MessageType.STATUS -> {
                sendStatus(outStream, frame.id)
            }

            MessageType.DISCONNECT_REQUEST -> {
                val reason = if (frame.payload.has("reason")) frame.payload.get("reason").asString else "USER_REQUESTED"
                Log.i(TAG, "PC disconnected: $reason")
                ServiceStateHolder.setPcDisconnected("PC disconnected ($reason)")
                ServiceStateHolder.logActivity("PC disconnected: $reason")
                synchronized(this@RelayForegroundService) {
                    try {
                        activeClientSocket?.close()
                    } catch (_: Exception) {}
                    activeClientSocket = null
                }
            }

            else -> {
                Log.w(TAG, "Unhandled message type in Phase 4: ${frame.type}")
            }
        }
    }

    private fun sendDeviceInfo(outStream: OutputStream, correlationId: String? = null) {
        checkNetModInstalled()
        val vpnActive = isVpnActive()
        val deviceInfo = DeviceInfoPayload(
            model = Build.MODEL,
            manufacturer = Build.MANUFACTURER,
            osVersion = Build.VERSION.RELEASE,
            apiLevel = Build.VERSION.SDK_INT,
            netModInstalled = isNetModInstalled,
            netModVersion = if (isNetModInstalled) "Installed (com.netmod.syna)" else null,
            vpnActive = vpnActive
        )
        val envelope = ControlEnvelope(
            id = correlationId ?: "info_${System.currentTimeMillis()}",
            type = MessageType.DEVICE_INFO,
            payload = deviceInfo
        )
        outStream.write(ProtocolFraming.encodeFrame(envelope))
        outStream.flush()
        Log.i(TAG, "Sent DEVICE_INFO: model=${deviceInfo.model}, netModInstalled=$isNetModInstalled, vpnActive=$vpnActive")
    }

    private fun sendStatus(outStream: OutputStream, correlationId: String? = null) {
        val state = ServiceStateHolder.state.value
        val statusPayload = StatusPayload(
            connectionState = state.connectionState,
            netModStatus = state.netModStatus,
            bytesReceived = state.totalBytesReceived,
            bytesSent = state.totalBytesSent,
            speedDownloadBps = state.downloadSpeedBps,
            speedUploadBps = state.uploadSpeedBps,
            activeSockets = state.activeSockets,
            uptimeSeconds = 0,
            relayPort = ProtocolConstants.DEFAULT_DATA_PORT
        )
        val envelope = ControlEnvelope(
            id = correlationId ?: "status_${System.currentTimeMillis()}",
            type = MessageType.STATUS,
            payload = statusPayload
        )
        outStream.write(ProtocolFraming.encodeFrame(envelope))
        outStream.flush()
    }

    private fun sendErrorFrame(outStream: OutputStream, code: ErrorCode, message: String, replyToId: String?) {
        try {
            val errorPayload = ErrorPayload(
                code = code,
                message = message,
                recoverable = true
            )
            val envelope = ControlEnvelope(
                id = replyToId ?: "err_${System.currentTimeMillis()}",
                type = MessageType.ERROR,
                payload = errorPayload
            )
            outStream.write(ProtocolFraming.encodeFrame(envelope))
            outStream.flush()
        } catch (_: Exception) {}
    }

    private fun startForegroundWithNotification(statusText: String) {
        val notification = buildNotification(statusText)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(statusText: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(statusText))
    }

    private fun buildNotification(statusText: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(statusText)
            .setSmallIcon(R.drawable.ic_shield)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_desc)
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "RelayForegroundService onDestroy")
        releaseWakeLock()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && thermalListener != null) {
            try {
                val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                powerManager.removeThermalStatusListener(thermalListener!!)
            } catch (_: Exception) {}
        }
        serviceScope.cancel()
        telemetryJob?.cancel()
        telemetryJob = null
        socks5Proxy?.stop()
        socks5Proxy = null

        try {
            activeClientSocket?.close()
        } catch (_: Exception) {}
        try {
            serverSocket?.close()
        } catch (_: Exception) {}
        ServiceStateHolder.setServiceStopped()
        ServiceStateHolder.logActivity("USB Service Stopped")
    }
}
