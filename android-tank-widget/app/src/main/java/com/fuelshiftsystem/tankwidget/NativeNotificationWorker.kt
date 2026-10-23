package com.fuelshiftsystem.tankwidget

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.graphics.BitmapFactory
import android.graphics.Color
import android.content.res.ColorStateList
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
        val notificationPrefs = applicationContext.getSharedPreferences("fuel_native_notifications", Context.MODE_PRIVATE)
        if (!notificationPrefs.getBoolean("enabled", false)) {
            renderNotificationWidget(emptyList(), "Phone notifications are paused")
            return Result.success()
        }
        val base = prefs.getString(TankWidgetWorker.KEY_BASE_URL, TankWidgetWorker.DEFAULT_BASE_URL)?.trimEnd('/')
        val cookie = prefs.getString(TankWidgetWorker.KEY_ADMIN_COOKIE, null)
        if (base.isNullOrBlank() || cookie.isNullOrBlank()) {
            renderNotificationWidget(emptyList(), "Sign in to load station notifications")
            return Result.success()
        }
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
            val items = (0 until rows.length()).mapNotNull { index ->
                val row = rows.optJSONObject(index) ?: return@mapNotNull null
                InboxItem(
                    key = row.optString("key", row.optString("id", "")),
                    title = row.optString("title", "Fuel Shift System"),
                    detail = row.optString("detail", ""),
                    href = row.optString("href", "/admin-inbox.html"),
                    level = row.optString("level", "info"),
                    read = row.optBoolean("is_read", false)
                )
            }.toMutableList()

            // Recheck live operational endpoints so native alerts work while the
            // dashboard is closed, not only after the web inbox sync has run.
            val sales = fetchRows(base, cookie, "/api/sales/confirmations")
            val reports = fetchRows(base, cookie, "/api/reports/daily/confirmations")
            val purchases = fetchRows(base, cookie, "/api/purchases")
            val tanks = fetchRows(base, cookie, "/api/tanks")
            if (sales.isNotEmpty()) {
                val salesKey = sales.map { it.optString("id", it.optString("shift_id", it.optString("dispenser_code"))) }.sorted().joinToString("-")
                items.add(InboxItem("native-live-pending-sales-" + salesKey, "Sales pending confirmation",
                    sales.size.toString() + " shift sale record(s) are waiting for administrator review and confirmation.",
                    "/admin-sales.html", "warning", false))
            }
            val readyReports = reports.filter { report ->
                report.optString("status") == "pending" &&
                    report.optBoolean("report_day_closed", true) &&
                    report.optBoolean("all_shifts_complete", false) &&
                    report.optBoolean("all_handover_recorded", false) &&
                    report.optBoolean("all_sales_recorded", false)
            }
            if (readyReports.isNotEmpty()) {
                val latestDate = readyReports.map { it.optString("date") }.filter { it.isNotBlank() }.sorted().lastOrNull().orEmpty()
                val reportKey = readyReports.map { it.optString("id", it.optString("date")) }.sorted().joinToString("-")
                items.add(InboxItem("native-live-pending-dsr-" + reportKey, "DSR ready for confirmation",
                    readyReports.size.toString() + " daily report(s) are ready for admin review and confirmation.",
                    "/admin-daily-report.html", "warning", false))
            }
            val pendingPurchases = purchases.filter {
                val status = it.optString("discharge_status", it.optString("status")).lowercase()
                status !in listOf("discharged", "cancelled", "canceled", "void")
            }
            if (pendingPurchases.isNotEmpty()) {
                val ids = pendingPurchases.map { it.optString("id", it.optString("invoice_number")) }.sorted()
                val labels = pendingPurchases.take(4).joinToString(" · ") { it.optString("invoice_number", it.optString("product", "Purchase")) }
                items.add(InboxItem("native-live-purchases-" + ids.joinToString("-"), "Purchase awaiting discharge",
                    pendingPurchases.size.toString() + " purchase(s) are still awaiting discharge" + if (labels.isBlank()) "." else ": " + labels,
                    "/admin-purchases.html", "warning", false))
            }
            val lowTanks = tanks.filter { tank ->
                val cap = tank.optDouble("capacity_liters", 0.0)
                tank.optBoolean("active", true) && cap > 0 && tank.optDouble("current_liters", 0.0) / cap <= 0.10
            }
            if (lowTanks.isNotEmpty()) {
                val key = lowTanks.map { it.optString("id", it.optString("tank_code")) }.sorted().joinToString("-")
                val labels = lowTanks.take(4).joinToString(" · ") { it.optString("tank_code", "Tank") + " " + it.optDouble("current_liters", 0.0).toInt() + " L" }
                items.add(InboxItem("native-live-low-tanks-" + key, "Low tank stock",
                    lowTanks.size.toString() + " tank(s) are at or below 10% capacity: " + labels,
                    "/admin-inventory.html", "warning", false))
            }
            return items.distinctBy { it.key }.sortedBy { it.read }.take(30)
        } finally {
            connection.disconnect()
        }
    }

    private fun fetchRows(base: String, cookie: String, path: String): List<JSONObject> {
        return try {
            val connection = URL(base + path).openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 9000
            connection.readTimeout = 9000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("X-Fuel-Role", "admin")
            connection.setRequestProperty("Cookie", TankWidgetWorker.ADMIN_COOKIE_NAME + "=" + cookie)
            try {
                if (connection.responseCode !in 200..299) return emptyList()
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val array = JSONArray(body)
                (0 until array.length()).mapNotNull { array.optJSONObject(it) }
            } finally { connection.disconnect() }
        } catch (_: Exception) { emptyList() }
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
        val appIcon = try { BitmapFactory.decodeResource(applicationContext.resources, applicationContext.applicationInfo.icon) } catch (_: Exception) { null }
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_fuel)
            .apply { if (appIcon != null) setLargeIcon(appIcon) }
            .setContentTitle(item.title.ifBlank { "Fuel Shift System Admin" })
            .setContentText(item.detail.ifBlank { "A station update needs your attention." })
            .setStyle(NotificationCompat.BigTextStyle().bigText(item.detail.ifBlank { "A station update needs your attention." }))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVibrate(longArrayOf(0, 350, 180, 350))
            .setTicker(item.title.ifBlank { "Fuel Shift System Admin" })
            .setPriority(if (item.level == "critical" || item.level == "warning") NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
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
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Fuel Shift System Admin alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Heads-up alerts for station inbox, shifts, sales and inventory"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 350, 180, 350)
                setShowBadge(true)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
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
            refresh(context)
        }
        fun refresh(context: Context) {
            WorkManager.getInstance(context).enqueue(androidx.work.OneTimeWorkRequestBuilder<NativeNotificationWorker>().build())
        }
        fun disable(context: Context) {
            context.getSharedPreferences("fuel_native_notifications", Context.MODE_PRIVATE).edit().putBoolean("enabled", false).apply()
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
            refresh(context)
        }
    }
}
