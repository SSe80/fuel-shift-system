package com.fuelshiftsystem.tankwidget

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

class NativeNotificationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val prefs = securePrefs()
        val base = prefs.getString(TankWidgetWorker.KEY_BASE_URL, TankWidgetWorker.DEFAULT_BASE_URL)?.trimEnd('/')
        val cookie = prefs.getString(TankWidgetWorker.KEY_ADMIN_COOKIE, null)
        if (base.isNullOrBlank() || cookie.isNullOrBlank()) return Result.success()
        return try {
            val items = loadInbox(base, cookie)
            renderNotificationWidget(items)
            val seen = applicationContext.getSharedPreferences(SEEN_PREFS, Context.MODE_PRIVATE)
            val seenKeys = seen.getStringSet(SEEN_KEYS, emptySet())?.toMutableSet() ?: mutableSetOf()
            val unread = items.filter { !it.read && it.key.isNotBlank() }
            val newItems = unread.filter { it.key !in seenKeys }
            newItems.take(5).forEach { item -> showNotification(item) }
            // Bound local history while avoiding repeat alerts for existing inbox rows.
            seenKeys.addAll(items.map { it.key }.filter { it.isNotBlank() })
            if (seenKeys.size > 500) {
                val keep = items.map { it.key }.filter { it.isNotBlank() }.toSet()
                seenKeys.retainAll(keep)
            }
            seen.edit().putStringSet(SEEN_KEYS, seenKeys).apply()
            Result.success()
        } catch (e: UnauthorizedException) {
            prefs.edit().remove(TankWidgetWorker.KEY_ADMIN_COOKIE).apply()
            renderNotificationWidget(emptyList(), "Sign in again to reconnect notifications")
            Result.success()
        } catch (_: Exception) {
            renderNotificationWidget(emptyList(), "Could not refresh · tap to open Admin")
            Result.retry()
        }
    }

    private fun loadInbox(base: String, cookie: String): List<InboxItem> {
        val connection = URL("$base/api/inbox").openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 12000
        connection.readTimeout = 12000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("X-Fuel-Role", "admin")
        connection.setRequestProperty("Cookie", TankWidgetWorker.ADMIN_COOKIE_NAME + "=" + cookie)
        try {
            val status = connection.responseCode
            if (status == 401 || status == 403) throw UnauthorizedException()
            if (status !in 200..299) throw IllegalStateException("Inbox API returned HTTP $status")
            val body = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val rows = body.optJSONArray("items") ?: JSONArray()
            return (0 until rows.length()).mapNotNull { index ->
                val row = rows.optJSONObject(index) ?: return@mapNotNull null
                InboxItem(
                    key = row.optString("key", row.optString("id", "")),
                    title = row.optString("title", "Fuel Shift System"),
                    detail = row.optString("detail", ""),
                    href = row.optString("href", "/admin-inbox.html"),
                    level = row.optString("level", "info"),
                    read = row.optBoolean("is_read", false)
                )
            }.sortedBy { it.read }.take(30)
        } finally {
            connection.disconnect()
        }
    }

    private fun showNotification(item: InboxItem) {
        createChannel()
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val open = Intent(applicationContext, AdminActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NOTIFICATION_URL, item.href)
        }
        val pending = PendingIntent.getActivity(applicationContext, item.key.hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val icon = android.R.drawable.ic_dialog_info
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(icon)
            .setContentTitle(item.title.ifBlank { "Fuel Shift System" })
            .setContentText(item.detail.ifBlank { "A station update needs your attention." })
            .setStyle(NotificationCompat.BigTextStyle().bigText(item.detail.ifBlank { "A station update needs your attention." }))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(if (item.level == "critical" || item.level == "warning") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .build()
        NotificationManagerCompat.from(applicationContext).notify(item.key.hashCode(), notification)
    }

    private fun renderNotificationWidget(items: List<InboxItem>, statusOverride: String? = null) {
        val manager = AppWidgetManager.getInstance(applicationContext)
        val ids = manager.getAppWidgetIds(ComponentName(applicationContext, NotificationWidgetProvider::class.java))
        if (ids.isEmpty()) return
        ids.forEach { id ->
            val views = android.widget.RemoteViews(applicationContext.packageName, R.layout.notification_widget)
            views.removeAllViews(R.id.notification_widget_items)
            val unreadCount = items.count { !it.read }
            views.setTextViewText(R.id.notification_widget_status, statusOverride ?: if (items.isEmpty()) "No station notifications" else "$unreadCount unread · refreshed just now")
            items.take(4).forEach { item ->
                val row = android.widget.RemoteViews(applicationContext.packageName, R.layout.notification_widget_row)
                row.setTextViewText(R.id.notification_item_title, item.title)
                row.setTextViewText(R.id.notification_item_detail, item.detail)
                row.setTextViewText(R.id.notification_item_marker, if (item.read) "○" else "●")
                views.addView(R.id.notification_widget_items, row)
            }
            val open = Intent(applicationContext, AdminActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_NOTIFICATION_URL, "/admin-inbox.html")
            }
            views.setOnClickPendingIntent(R.id.notification_widget_root, PendingIntent.getActivity(
                applicationContext, id + 7000, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            views.setOnClickPendingIntent(R.id.notification_widget_refresh, PendingIntent.getBroadcast(
                applicationContext, id + 8000, Intent(applicationContext, NotificationWidgetProvider::class.java).setAction(NotificationWidgetProvider.ACTION_REFRESH),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            manager.updateAppWidget(id, views)
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Fuel Shift System alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Important station inbox, shift, sales and inventory alerts"
            })
        }
    }

    private fun securePrefs() = EncryptedSharedPreferences.create(
        applicationContext, TankWidgetWorker.PREFS_NAME,
        MasterKey.Builder(applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    data class InboxItem(val key: String, val title: String, val detail: String, val href: String, val level: String, val read: Boolean)
    class UnauthorizedException : Exception()

    companion object {
        const val CHANNEL_ID = "fuel_station_alerts"
        const val EXTRA_NOTIFICATION_URL = "fuel_notification_url"
        private const val PERIODIC_WORK = "fuel-native-notifications-refresh"
        private const val SEEN_PREFS = "fuel_native_notification_seen"
        private const val SEEN_KEYS = "keys"
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<NativeNotificationWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
            WorkManager.getInstance(context).enqueue(androidx.work.OneTimeWorkRequestBuilder<NativeNotificationWorker>().build())
        }
        fun refresh(context: Context) {
            WorkManager.getInstance(context).enqueue(androidx.work.OneTimeWorkRequestBuilder<NativeNotificationWorker>().build())
        }
    }
}
