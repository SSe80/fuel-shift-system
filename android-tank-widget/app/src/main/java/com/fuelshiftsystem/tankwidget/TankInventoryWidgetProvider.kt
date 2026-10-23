package com.fuelshiftsystem.tankwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class TankInventoryWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.tank_inventory_widget)
            val refresh = Intent(context, TankInventoryWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, id, refresh, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            val base = context.getSharedPreferences(TankWidgetWorker.PREFS_NAME, Context.MODE_PRIVATE)
                .getString(TankWidgetWorker.KEY_BASE_URL, TankWidgetWorker.DEFAULT_BASE_URL) ?: TankWidgetWorker.DEFAULT_BASE_URL
            val inventory = Intent(Intent.ACTION_VIEW, Uri.parse(base.trimEnd('/') + "/admin-tanks.html"))
            views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, id, inventory, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            manager.updateAppWidget(id, views)
        }
        schedulePeriodicRefresh(context)
        enqueueRefresh(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) enqueueRefresh(context)
    }

    companion object {
        const val ACTION_REFRESH = "com.fuelshiftsystem.tankwidget.REFRESH_TANKS"
        private const val PERIODIC_WORK = "fuel-tank-widget-periodic-refresh"
        fun enqueueRefresh(context: Context) {
            WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<TankWidgetWorker>().build())
        }
        fun schedulePeriodicRefresh(context: Context) {
            val request = PeriodicWorkRequestBuilder<TankWidgetWorker>(30, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
        }
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            if (manager.getAppWidgetIds(ComponentName(context, TankInventoryWidgetProvider::class.java)).isNotEmpty()) enqueueRefresh(context)
        }
    }
}
