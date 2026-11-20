package com.usbvpnbridge.android.proxy

import android.util.Log
import kotlinx.coroutines.*
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * High-performance, non-root SOCKS5 TCP CONNECT Proxy Server.
 *
 * Listens exclusively on 127.0.0.1:10808 (Android Loopback).
 * Adheres to RFC 1928 (SOCKS Protocol Version 5).
 * Routes TCP connections over Android's active network (including NetMod VPN if active).
 */
class Socks5ProxyServer(
    private val port: Int = 10808
) {
    companion object {
        private const val TAG = "Socks5ProxyServer"
        private const val BUFFER_SIZE = 65536 // 64 KB bounded buffer for high-throughput tethering
        private const val CONNECT_TIMEOUT_MS = 15000 // 15 seconds connect timeout
        private const val SOCKET_READ_TIMEOUT_MS = 0 // 0 = infinite read timeout during active streaming
    }

    private var serverSocket: ServerSocket? = null
    private var proxyJob: Job? = null
    @Volatile private var isRunning: Boolean = false

    // Telemetry & Metrics
    val activeSockets = AtomicInteger(0)
    val totalBytesReceived = AtomicLong(0) // Download (Target -> Client)
    val totalBytesSent = AtomicLong(0)     // Upload (Client -> Target)

    private val activeConnections = ConcurrentHashMap<Long, SocketPair>()
    private val connectionIdCounter = AtomicLong(0)

    private data class SocketPair(
        val clientSocket: Socket,
        var targetSocket: Socket? = null
    )

    fun start(scope: CoroutineScope) {
        if (isRunning) return
        isRunning = true

        proxyJob = scope.launch(Dispatchers.IO) {
            try {
                // Bind exclusively to 127.0.0.1 loopback
                val loopback = InetAddress.getByName("127.0.0.1")
                serverSocket = ServerSocket(port, 50, loopback).apply {
                    reuseAddress = true
                }
                Log.i(TAG, "SOCKS5 TCP Proxy listening on 127.0.0.1:$port")

                while (isActive && isRunning) {
                    try {
                        val clientSocket = serverSocket?.accept() ?: break
                        clientSocket.tcpNoDelay = true
                        clientSocket.sendBufferSize = 262144
                        clientSocket.receiveBufferSize = 131072

                        val connId = connectionIdCounter.incrementAndGet()
                        val pair = SocketPair(clientSocket)
                        activeConnections[connId] = pair

                        launch(Dispatchers.IO) {
                            try {
                                handleClient(connId, pair)
                            } finally {
                                activeConnections.remove(connId)
                            }
                        }
                    } catch (e: SocketException) {
                        if (!isRunning) break
                        Log.w(TAG, "ServerSocket accept exception: ${e.message}")
                    } catch (e: Exception) {
                        Log.e(TAG, "Unexpected error in accept loop", e)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start SOCKS5 Proxy Server", e)
            } finally {
                stop()
            }
        }
    }

    private suspend fun handleClient(connId: Long, pair: SocketPair) = withContext(Dispatchers.IO) {
        val client = pair.clientSocket
        var target: Socket? = null

        try {
            val inClient = client.getInputStream()
            val outClient = client.getOutputStream()

            // 1. Negotiation Phase (RFC 1928, Section 3)
            val ver = inClient.read()
            if (ver != 0x05) {
                Log.w(TAG, "[$connId] Invalid SOCKS version: $ver")
                return@withContext
            }

            val nMethods = inClient.read()
            if (nMethods <= 0) {
                Log.w(TAG, "[$connId] Invalid nMethods: $nMethods")
                return@withContext
            }

            val methods = ByteArray(nMethods)
            readFully(inClient, methods)

            var supportsNoAuth = false
            for (m in methods) {
                if (m.toInt() and 0xFF == 0x00) {
                    supportsNoAuth = true
                    break
                }
            }

            if (!supportsNoAuth) {
                Log.w(TAG, "[$connId] No acceptable auth methods")
                outClient.write(byteArrayOf(0x05, 0xFF.toByte()))
                outClient.flush()
                return@withContext
            }

            // Acknowledge No Auth (0x00)
            outClient.write(byteArrayOf(0x05, 0x00))
            outClient.flush()

            // 2. Request Phase (RFC 1928, Section 4)
            val reqVer = inClient.read()
            val reqCmd = inClient.read()
            val reqRsv = inClient.read()
            val reqAtyp = inClient.read()

            if (reqVer != 0x05) {
                Log.w(TAG, "[$connId] Invalid request version: $reqVer")
                return@withContext
            }

            // Only CONNECT (0x01) supported
            if (reqCmd != 0x01) {
                Log.w(TAG, "[$connId] Unsupported SOCKS command: $reqCmd")
                sendReply(outClient, 0x07) // Command not supported
                return@withContext
            }

            val targetHost: String
            val targetAddress: InetAddress?

            when (reqAtyp) {
                0x01 -> { // IPv4
                    val ipv4 = ByteArray(4)
                    readFully(inClient, ipv4)
                    targetAddress = InetAddress.getByAddress(ipv4)
                    targetHost = targetAddress.hostAddress ?: ""
                }
                0x03 -> { // Domain name (Remote DNS resolution on Android)
                    val domainLen = inClient.read()
                    if (domainLen <= 0) {
                        sendReply(outClient, 0x01) // General failure
                        return@withContext
                    }
                    val domainBytes = ByteArray(domainLen)
                    readFully(inClient, domainBytes)
                    targetHost = String(domainBytes, Charsets.US_ASCII)
                    targetAddress = null
                }
                0x04 -> { // IPv6
                    val ipv6 = ByteArray(16)
                    readFully(inClient, ipv6)
                    targetAddress = InetAddress.getByAddress(ipv6)
                    targetHost = targetAddress.hostAddress ?: ""
                }
                else -> {
                    Log.w(TAG, "[$connId] Unsupported address type: $reqAtyp")
                    sendReply(outClient, 0x08) // Address type not supported
                    return@withContext
                }
            }

            val portBuf = ByteArray(2)
            readFully(inClient, portBuf)
            val targetPort = ((portBuf[0].toInt() and 0xFF) shl 8) or (portBuf[1].toInt() and 0xFF)

            // Security check: Block loopback connection loops
            if ((targetHost == "127.0.0.1" || targetHost == "localhost" || targetHost == "::1") &&
                (targetPort == port || targetPort == 10809)) {
                Log.w(TAG, "[$connId] Blocked attempt to connect to self/control port: $targetPort")
                sendReply(outClient, 0x02) // Connection not allowed by ruleset
                return@withContext
            }

            // 3. Connect to Remote Destination
            try {
                target = Socket().apply {
                    tcpNoDelay = true
                    soTimeout = SOCKET_READ_TIMEOUT_MS
                    receiveBufferSize = 262144  // 256 KB receive buffer for download throughput
                    sendBufferSize = 131072     // 128 KB send buffer for upload throughput
                }
                pair.targetSocket = target

                val endpoint = if (targetAddress != null) {
                    InetSocketAddress(targetAddress, targetPort)
                } else {
                    // Let Android resolve domain remotely (goes through VPN if active)
                    InetSocketAddress(targetHost, targetPort)
                }

                target.connect(endpoint, CONNECT_TIMEOUT_MS)
            } catch (e: Exception) {
                Log.w(TAG, "[$connId] Failed connecting to $targetHost:$targetPort - ${e.message}")
                val repCode = when (e) {
                    is SocketTimeoutException -> 0x04.toByte() // Host unreachable
                    is SocketException -> 0x05.toByte()        // Connection refused
                    else -> 0x01.toByte()                      // General failure
                }
                sendReply(outClient, repCode.toInt())
                return@withContext
            }

            // Send Success Reply
            sendReply(outClient, 0x00)

            // 4. Bidirectional Byte Streaming
            activeSockets.incrementAndGet()

            val inTarget = target.getInputStream()
            val outTarget = target.getOutputStream()

            // Run upload and download streaming concurrently.
            // CRITICAL: Do NOT call shutdownOutput() on either socket when one direction
            // finishes. HTTP/1.1 keep-alive and TLS connections remain bidirectional.
            // Calling shutdownOutput() causes the peer to receive a TCP FIN, which breaks
            // the active download stream during heavy traffic. Instead, let both pipes
            // run until EOF or error, then close both sockets in the finally block.
            coroutineScope {
                // Upload: Client -> Target
                val uploadJob = launch(Dispatchers.IO) {
                    pipeStream(inClient, outTarget, totalBytesSent)
                }

                // Download: Target -> Client
                val downloadJob = launch(Dispatchers.IO) {
                    pipeStream(inTarget, outClient, totalBytesReceived)
                }

                // When either direction ends, cancel the other to avoid hanging
                launch {
                    uploadJob.join()
                    if (downloadJob.isActive) {
                        // Upload ended (client closed) — close target to unblock download read
                        try { target.shutdownInput() } catch (_: Exception) {}
                    }
                }
                launch {
                    downloadJob.join()
                    if (uploadJob.isActive) {
                        // Download ended (server closed) — close client to unblock upload read
                        try { client.shutdownInput() } catch (_: Exception) {}
                    }
                }

                uploadJob.join()
                downloadJob.join()
            }
        } catch (e: Exception) {
            // Socket reset / client disconnect expected in normal operation
            Log.d(TAG, "[$connId] Session finished or interrupted: ${e.message}")
        } finally {
            activeSockets.decrementAndGet()
            closeQuietly(client)
            closeQuietly(target)
        }
    }

    private fun pipeStream(input: InputStream, output: OutputStream, counter: AtomicLong) {
        val buffer = ByteArray(BUFFER_SIZE)
        try {
            while (true) {
                val bytesRead = input.read(buffer)
                if (bytesRead == -1) break
                output.write(buffer, 0, bytesRead)
                output.flush()
                counter.addAndGet(bytesRead.toLong())
            }
        } catch (_: Exception) {
            // End of stream or peer closed socket
        }
    }

    private fun readFully(inputStream: InputStream, buffer: ByteArray) {
        var offset = 0
        while (offset < buffer.size) {
            val count = inputStream.read(buffer, offset, buffer.size - offset)
            if (count == -1) {
                throw SocketException("Unexpected EOF while reading SOCKS5 frame")
            }
            offset += count
        }
    }

    private fun sendReply(out: OutputStream, repCode: Int) {
        try {
            // 0x05 = VER, repCode = REP, 0x00 = RSV, 0x01 = IPv4, 0.0.0.0 = BND.ADDR, 0 = BND.PORT
            val reply = byteArrayOf(
                0x05, repCode.toByte(), 0x00, 0x01,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00
            )
            out.write(reply)
            out.flush()
        } catch (_: Exception) {}
    }

    private fun closeQuietly(socket: Socket?) {
        try {
            socket?.close()
        } catch (_: Exception) {}
    }

    fun stop() {
        if (!isRunning) return
        isRunning = false
        Log.i(TAG, "Stopping SOCKS5 Proxy Server")

        try {
            serverSocket?.close()
        } catch (_: Exception) {}
        serverSocket = null

        // Close all active connections
        for ((_, pair) in activeConnections) {
            closeQuietly(pair.clientSocket)
            closeQuietly(pair.targetSocket)
        }
        activeConnections.clear()

        proxyJob?.cancel()
        proxyJob = null
    }
}
