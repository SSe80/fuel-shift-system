package com.fuelshiftsystem.tankwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class TankWidgetWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val manager = AppWidgetManager.getInstance(applicationContext)
        val ids = manager.getAppWidgetIds(ComponentName(applicationContext, TankInventoryWidgetProvider::class.java))
        if (ids.isEmpty()) return Result.success()
        val prefs = securePrefs()
        val base = prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL)?.trimEnd('/')
        val cookie = prefs.getString(KEY_ADMIN_COOKIE, null)
        if (base.isNullOrBlank() || cookie.isNullOrBlank()) {
            ids.forEach { renderMessage(manager, it, "Open widget app to sign in", "Tap to open Fuel Shift System") }
            return Result.success()
        }
        return try {
            val tanks = loadTanks(base, cookie)
            val updated = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
            ids.forEach { renderTanks(manager, it, tanks, updated) }
            Result.success()
        } catch (e: UnauthorizedException) {
            prefs.edit().remove(KEY_ADMIN_COOKIE).apply()
            ids.forEach { renderMessage(manager, it, "Session expired", "Open widget app to sign in again") }
            Result.success()
        } catch (e: Exception) {
            ids.forEach { renderMessage(manager, it, "Stock temporarily unavailable", "Tap refresh to try again") }
            Result.retry()
        }
    }

    private fun loadTanks(base: String, cookie: String): List<Tank> {
        val connection = URL(base + "/api/tanks").openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 12000
        connection.readTimeout = 12000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("X-Fuel-Role", "admin")
        connection.setRequestProperty("Cookie", ADMIN_COOKIE_NAME + "=" + cookie)
        try {
            val status = connection.responseCode
            if (status == 401 || status == 403) throw UnauthorizedException()
            if (status !in 200..299) throw IllegalStateException("Tank API returned HTTP " + status)
            val json = JSONArray(connection.inputStream.bufferedReader().use { it.readText() })
            val result = mutableListOf<Tank>()
            for (i in 0 until json.length()) {
                val item = json.optJSONObject(i) ?: continue
                if (item.has("active") && !item.optBoolean("active", true)) continue
                val capacity = item.optDouble("capacity_liters", 0.0).coerceAtLeast(0.0)
                val stock = item.optDouble("current_liters", 0.0).coerceAtLeast(0.0)
                if (capacity > 0.0) result.add(Tank(item.optString("tank_code", "Tank"), item.optString("product", ""), stock, capacity))
            }
            return result
        } finally { connection.disconnect() }
    }

    private fun renderTanks(manager: AppWidgetManager, id: Int, tanks: List<Tank>, updated: String) {
        val views = RemoteViews(applicationContext.packageName, R.layout.tank_inventory_widget)
        views.removeAllViews(R.id.widget_tanks)
        views.setTextViewText(R.id.widget_status, if (tanks.isEmpty()) "No active tanks found" else tanks.size.toString() + " active tanks")
        val number = DecimalFormat("#,##0.##")
        tanks.forEach { tank ->
            val row = RemoteViews(applicationContext.packageName, R.layout.tank_widget_row)
            val percent = ((tank.stock / tank.capacity) * 100.0).coerceIn(0.0, 100.0)
            val space = (tank.capacity - tank.stock).coerceAtLeast(0.0)
            val product = tank.product.ifBlank { tank.code.substringBefore("•").trim() }
            row.setTextViewText(R.id.tank_name, product + " • " + tank.code)
            row.setTextViewText(R.id.tank_stock, number.format(tank.stock) + " L of " + number.format(tank.capacity) + " L")
            row.setTextViewText(R.id.tank_percent, DecimalFormat("0.0").format(percent) + "%")
            row.setProgressBar(R.id.tank_level, 1000, (percent * 10).toInt(), false)
            row.setTextViewText(R.id.tank_space, number.format(space) + " L space")
            views.addView(R.id.widget_tanks, row)
        }
        views.setTextViewText(R.id.widget_updated, "Updated " + updated + " · Tap to open inventory")
        setActions(views, id)
        manager.updateAppWidget(id, views)
    }

    private fun renderMessage(manager: AppWidgetManager, id: Int, message: String, detail: String) {
        val views = RemoteViews(applicationContext.packageName, R.layout.tank_inventory_widget)
        views.removeAllViews(R.id.widget_tanks)
        views.setTextViewText(R.id.widget_status, message)
        views.setTextViewText(R.id.widget_updated, detail)
        setActions(views, id)
        manager.updateAppWidget(id, views)
    }

    private fun setActions(views: RemoteViews, id: Int) {
        val refresh = Intent(applicationContext, TankInventoryWidgetProvider::class.java).apply { action = TankInventoryWidgetProvider.ACTION_REFRESH }
        views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(applicationContext, id, refresh, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        val inventory = Intent(Intent.ACTION_VIEW, Uri.parse(DEFAULT_BASE_URL + "/admin-tanks.html"))
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(applicationContext, id, inventory, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }

    private fun securePrefs() = EncryptedSharedPreferences.create(
        applicationContext, PREFS_NAME,
        MasterKey.Builder(applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
    data class Tank(val code: String, val product: String, val stock: Double, val capacity: Double)
    class UnauthorizedException : Exception()
    companion object {
        const val PREFS_NAME = "fuel_tank_widget_secure"
        const val KEY_BASE_URL = "worker_base_url"
        const val KEY_ADMIN_COOKIE = "admin_session_cookie"
        const val DEFAULT_BASE_URL = "https://fuel-shift-system.servicestation50.workers.dev"
        const val ADMIN_COOKIE_NAME = "__Host-fuel_admin_session"
    }
}
