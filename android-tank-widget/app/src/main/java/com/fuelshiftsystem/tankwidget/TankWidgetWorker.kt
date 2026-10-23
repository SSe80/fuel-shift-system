package com.fuelshiftsystem.tankwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.content.res.ColorStateList
import android.os.Build
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
            ids.forEach { renderMessage(manager, it, "Connect your admin account", "Open Fuel Shift Admin → Tank Widget") }
            return Result.success()
        }
        return try {
            val productColors = loadProductColors(base, cookie)
            val tanks = loadTanks(base, cookie).map { tank ->
                val color = productColors[tank.productId.lowercase()]
                    ?: productColors[tank.product.lowercase()]
                    ?: productColors[tank.code.lowercase()]
                    ?: fallbackProductColor(tank.product.ifBlank { tank.code })
                tank.copy(color = color)
            }
            val updated = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
            ids.forEach { renderTanks(manager, it, tanks, updated) }
            Result.success()
        } catch (e: UnauthorizedException) {
            prefs.edit().remove(KEY_ADMIN_COOKIE).apply()
            ids.forEach { renderMessage(manager, it, "Admin session expired", "Open Fuel Shift Admin → Tank Widget") }
            Result.success()
        } catch (_: Exception) {
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
                if (capacity > 0.0) result.add(Tank(
                    item.optString("tank_code", "Tank"),
                    item.optString("product", ""),
                    stock,
                    capacity,
                    item.optString("product_id", ""),
                    "#1769D2"
                ))
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
            if (Build.VERSION.SDK_INT >= 31) {
                try { row.setColorStateList(R.id.tank_level, "setProgressTintList", ColorStateList.valueOf(Color.parseColor(tank.color))) } catch (_: Exception) { }
                try { row.setTextColor(R.id.tank_percent, Color.parseColor(tank.color)) } catch (_: Exception) { }
            }
            row.setTextViewText(R.id.tank_space, number.format(space) + " L space")
            views.addView(R.id.widget_tanks, row)
        }
        views.setTextViewText(R.id.widget_updated, "Updated " + updated + " · Tap to open Admin")
        setActions(views, id)
        manager.updateAppWidget(id, views)
    }

    private fun loadProductColors(base: String, cookie: String): Map<String, String> {
        return try {
            val connection = URL(base + "/api/products").openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 9000
            connection.readTimeout = 9000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("X-Fuel-Role", "admin")
            connection.setRequestProperty("Cookie", ADMIN_COOKIE_NAME + "=" + cookie)
            try {
                if (connection.responseCode !in 200..299) return emptyMap()
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val array = JSONArray(body)
                val colors = mutableMapOf<String, String>()
                for (i in 0 until array.length()) {
                    val product = array.optJSONObject(i) ?: continue
                    val color = product.optString("color", "").trim()
                    if (!color.matches(Regex("^#[0-9a-fA-F]{6}$"))) continue
                    listOf("id", "code_name", "name").forEach { key ->
                        val value = product.optString(key, "").trim().lowercase()
                        if (value.isNotBlank()) colors[value] = color
                    }
                }
                colors
            } finally { connection.disconnect() }
        } catch (_: Exception) { emptyMap() }
    }

    private fun fallbackProductColor(product: String): String {
        val code = product.trim().uppercase()
        return when {
            code.contains("MGR") || code.contains("GASOLINE") || code.contains("PETROL") -> "#E4572E"
            code.contains("AGO") || code.contains("DIESEL") -> "#2563EB"
            code.contains("KEROSENE") || code.contains("KERO") -> "#D97706"
            code.contains("LPG") -> "#7C3AED"
            else -> "#1769D2"
        }
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
        views.setOnClickPendingIntent(R.id.widget_root, TankInventoryWidgetProvider.openAdminIntent(applicationContext, id))
    }

    private fun securePrefs() = EncryptedSharedPreferences.create(
        applicationContext, PREFS_NAME,
        MasterKey.Builder(applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
    data class Tank(val code: String, val product: String, val stock: Double, val capacity: Double, val productId: String, val color: String)
    class UnauthorizedException : Exception()
    companion object {
        const val PREFS_NAME = "fuel_tank_widget_secure"
        const val KEY_BASE_URL = "worker_base_url"
        const val KEY_ADMIN_COOKIE = "admin_session_cookie"
        const val DEFAULT_BASE_URL = "https://fuel-shift-system.servicestation50.workers.dev"
        const val ADMIN_COOKIE_NAME = "__Host-fuel_admin_session"
    }
}
