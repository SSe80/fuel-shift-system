package com.fuelshiftsystem.tankwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

class TankInventoryWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.tank_inventory_widget)
            val refresh = Intent(context, TankInventoryWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, id, refresh, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            val setup = Intent(context, WidgetSetupActivity::class.java)
            views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, id, setup, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            manager.updateAppWidget(id, views)
        }
        enqueueRefresh(context)
    }
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) enqueueRefresh(context)
    }
    companion object {
        const val ACTION_REFRESH = "com.fuelshiftsystem.tankwidget.REFRESH_TANKS"
        fun enqueueRefresh(context: Context) {
            WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<TankWidgetWorker>().build())
        }
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            if (manager.getAppWidgetIds(ComponentName(context, TankInventoryWidgetProvider::class.java)).isNotEmpty()) enqueueRefresh(context)
        }
    }
}
