package dev.minicord.app

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service whose only job is to keep the process — and so the Discord connection in
 * [MinicordRuntime] — alive while the UI is closed. Third-party apps can't receive Discord's
 * push notifications, so this is the only reliable way to get messages in the background.
 */
class GatewayService : Service() {
    companion object {
        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, GatewayService::class.java))
        }
    }

    override fun onCreate() {
        super.onCreate()
        MinicordRuntime.init(this)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, Notifier.SERVICE_NOTIFICATION_ID, MinicordRuntime.notifier.serviceNotification("Connecting…"), type)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!MinicordRuntime.hasToken()) {
            stopSelf()
            return START_NOT_STICKY
        }
        MinicordRuntime.start()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

/** Heartbeat and notification-flush alarms (they fire even when the device is idle). */
class WakeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        MinicordRuntime.init(context)
        when (intent.action) {
            MinicordRuntime.ACTION_HEARTBEAT -> MinicordRuntime.onWakeAlarm()
            MinicordRuntime.ACTION_FLUSH -> {
                MinicordRuntime.keepAwake(5_000)
                MinicordRuntime.flushDue()
            }
        }
    }
}

/** Reconnect after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        MinicordRuntime.init(context)
        if (MinicordRuntime.hasToken()) GatewayService.start(context)
    }
}
