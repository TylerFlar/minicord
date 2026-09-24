package dev.minicord.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** System notifications. Channels map to what the user can tune in Android settings. */
class Notifier(private val context: Context) {
    companion object {
        const val CH_DMS = "dms"
        const val CH_MENTIONS = "mentions"
        const val CH_CALLS = "calls"
        const val CH_EVENTS = "events"
        const val CH_SUMMARY = "summary"
        const val CH_SERVICE = "service"
        const val SERVICE_NOTIFICATION_ID = 1
        const val EXTRA_ROUTE = "minicord_route"
    }

    fun ensureChannels() {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CH_DMS, "Direct messages", NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(CH_MENTIONS, "Mentions and replies", NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CH_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(CH_EVENTS, "Event reminders", NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CH_SUMMARY, "Digests and summaries", NotificationManager.IMPORTANCE_LOW),
                NotificationChannel(CH_SERVICE, "Connection", NotificationManager.IMPORTANCE_MIN).apply {
                    description = "Keeps minicord connected so messages arrive. Safe to hide."
                    setShowBadge(false)
                },
            ),
        )
    }

    private fun openApp(routeJson: String?, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (routeJson != null) putExtra(EXTRA_ROUTE, routeJson)
        }
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun post(tag: String, title: String, body: String, channel: String, routeJson: String?) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val id = tag.hashCode()
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_minicord)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openApp(routeJson, id))
            .setAutoCancel(true)
            .setCategory(
                when (channel) {
                    CH_CALLS -> NotificationCompat.CATEGORY_CALL
                    CH_EVENTS -> NotificationCompat.CATEGORY_EVENT
                    else -> NotificationCompat.CATEGORY_MESSAGE
                },
            )
            .setPriority(if (channel == CH_DMS || channel == CH_CALLS) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .build()
        NotificationManagerCompat.from(context).notify(tag, id, notification)
    }

    fun serviceNotification(text: String): Notification =
        NotificationCompat.Builder(context, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_minicord)
            .setContentTitle("minicord")
            .setContentText(text)
            .setContentIntent(openApp(null, 0))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

    fun updateService(text: String) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        NotificationManagerCompat.from(context).notify(SERVICE_NOTIFICATION_ID, serviceNotification(text))
    }
}
