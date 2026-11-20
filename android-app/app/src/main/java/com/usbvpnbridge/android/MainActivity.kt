package com.usbvpnbridge.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.usbvpnbridge.android.R
import com.usbvpnbridge.android.databinding.ActivityMainBinding
import com.usbvpnbridge.android.service.PcConnectionStatus
import com.usbvpnbridge.android.service.RelayForegroundService
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val viewModel: MainViewModel by viewModels()
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupListeners()
        observeUiState()

        viewModel.checkDeviceEnvironment(this)

        // Start service internally within app UID
        if (intent?.getBooleanExtra("start_service", false) == true) {
            RelayForegroundService.start(this)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra("start_service", false)) {
            RelayForegroundService.start(this)
        } else if (intent.getBooleanExtra("stop_service", false)) {
            RelayForegroundService.stop(this)
        }
    }

    private fun setupListeners() {
        binding.btnSettings.setOnClickListener {
            showBatteryOptimizationDialog()
        }

        binding.btnServiceControl.setOnClickListener {
            viewModel.toggleService(this)
        }

        binding.btnCopyLogs.setOnClickListener {
            val logText = binding.tvActivityLogs.text.toString()
            if (logText.isNotEmpty()) {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("USB VPN Bridge Logs", logText)
                clipboard.setPrimaryClip(clip)
                Toast.makeText(this, "Logs copied to clipboard", Toast.LENGTH_SHORT).show()
            }
        }

        binding.btnClearLogs.setOnClickListener {
            viewModel.clearLogs()
            binding.tvActivityLogs.text = "Logs cleared."
        }
    }

    private fun showBatteryOptimizationDialog() {
        AlertDialog.Builder(this)
            .setTitle("Screen-Off Tethering & Battery")
            .setMessage(
                "To ensure USB VPN Bridge continues tethering and processing heartbeats when your phone screen is turned off or locked, please allow the app to ignore battery optimizations.\n\n" +
                "• USB Control: 127.0.0.1:10809\n" +
                "• SOCKS5 Proxy: 127.0.0.1:10808\n" +
                "• Screen-Off WakeLock: Active when tethering"
            )
            .setPositiveButton("Open Settings") { _, _ ->
                try {
                    val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    startActivity(intent)
                } catch (e: Exception) {
                    try {
                        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.fromParts("package", packageName, null)
                        }
                        startActivity(intent)
                    } catch (_: Exception) {
                        Toast.makeText(this, "Could not open settings", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun observeUiState() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.uiState.collect { state ->
                    binding.tvDeviceModel.text = state.deviceModel
                    binding.tvAndroidVersion.text = state.androidVersion

                    // Windows PC Connection Status
                    binding.tvPcConnectionStatus.text = state.pcStatusText
                    binding.tvStatusDescription.text = state.statusDescription
                    binding.tvConnectionDuration.text = state.connectionDurationText
                    binding.tvLastHeartbeat.text = state.lastHeartbeatText

                    when (state.pcStatus) {
                        PcConnectionStatus.CONNECTED -> {
                            binding.viewStatusDot.setBackgroundResource(R.drawable.dot_green)
                            binding.tvPcConnectionStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.accent_emerald))
                        }
                        PcConnectionStatus.CONNECTING -> {
                            binding.viewStatusDot.setBackgroundResource(R.drawable.dot_amber)
                            binding.tvPcConnectionStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.accent_amber))
                        }
                        PcConnectionStatus.DISCONNECTED -> {
                            binding.viewStatusDot.setBackgroundResource(R.drawable.dot_red)
                            binding.tvPcConnectionStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.accent_rose))
                        }
                        PcConnectionStatus.SERVICE_STOPPED -> {
                            binding.viewStatusDot.setBackgroundResource(R.drawable.dot_gray)
                            binding.tvPcConnectionStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_muted))
                        }
                    }

                    // Connected PC Name row
                    if (!state.pcName.isNullOrEmpty() && state.pcStatus == PcConnectionStatus.CONNECTED) {
                        binding.rowPcName.visibility = View.VISIBLE
                        binding.tvPcName.text = state.pcName
                    } else {
                        binding.rowPcName.visibility = View.GONE
                    }

                    // Service Button Control
                    if (state.isServiceRunning) {
                        binding.btnServiceControl.text = "Stop USB Service"
                        binding.btnServiceControl.setBackgroundColor(
                            ContextCompat.getColor(this@MainActivity, R.color.accent_rose)
                        )
                    } else {
                        binding.btnServiceControl.text = "Start USB Service"
                        binding.btnServiceControl.setBackgroundColor(
                            ContextCompat.getColor(this@MainActivity, R.color.accent_blue)
                        )
                    }

                    // Telemetry & Metrics
                    binding.tvActiveSockets.text = state.activeSockets.toString()
                    binding.tvDownloadSpeed.text = state.downloadSpeedText
                    binding.tvUploadSpeed.text = state.uploadSpeedText
                    binding.tvTotalData.text = state.totalDataText
                    binding.tvProxyStatusBadge.text = if (state.isServiceRunning) "127.0.0.1:10808 (Active)" else "Inactive"
                    binding.tvProxyStatusBadge.setTextColor(
                        if (state.isServiceRunning) ContextCompat.getColor(this@MainActivity, R.color.accent_emerald)
                        else ContextCompat.getColor(this@MainActivity, R.color.text_muted)
                    )

                    // Thermal status
                    binding.tvThermalStatus.text = state.thermalStatus
                    binding.tvThermalStatus.setTextColor(
                        when {
                            state.thermalStatus.contains("Severe", ignoreCase = true) ->
                                ContextCompat.getColor(this@MainActivity, R.color.accent_rose)
                            state.thermalStatus.contains("Moderate", ignoreCase = true) ->
                                ContextCompat.getColor(this@MainActivity, R.color.accent_amber)
                            else ->
                                ContextCompat.getColor(this@MainActivity, R.color.accent_emerald)
                        }
                    )

                    // NetMod VPN Status
                    binding.tvNetModStatus.text = state.netModStatusText
                    if (state.isVpnActive) {
                        binding.tvNetModStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.accent_emerald))
                    } else if (state.netModInstalled) {
                        binding.tvNetModStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.accent_amber))
                    } else {
                        binding.tvNetModStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.accent_rose))
                    }

                    // Activity Logs
                    if (state.logs.isNotEmpty()) {
                        val formatted = state.logs.joinToString("\n") { entry ->
                            "[${timeFormat.format(Date(entry.timestamp))}] ${entry.message}"
                        }
                        binding.tvActivityLogs.text = formatted
                        binding.scrollLogs.post {
                            binding.scrollLogs.fullScroll(View.FOCUS_DOWN)
                        }
                    } else {
                        binding.tvActivityLogs.text = "No recent activity."
                    }
                }
            }
        }
    }
}
