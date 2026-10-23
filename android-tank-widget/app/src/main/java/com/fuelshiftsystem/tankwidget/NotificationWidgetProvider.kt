package com.fuelshiftsystem.tankwidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent

class NotificationWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        NativeNotificationWorker.refresh(context)
        appWidgetIds.forEach { id ->
            val views = android.widget.RemoteViews(context.packageName, R.layout.notification_widget)
            views.setTextViewText(R.id.notification_widget_status, "Loading station notifications…")
            val open = Intent(context, AdminActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(NativeNotificationWorker.EXTRA_NOTIFICATION_URL, "/admin-inbox.html")
            }
            views.setOnClickPendingIntent(R.id.notification_widget_root, android.app.PendingIntent.getActivity(
                context, id + 7000, open, android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE))
            manager.updateAppWidget(id, views)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) NativeNotificationWorker.refresh(context)
    }

    companion object {
        const val ACTION_REFRESH = "com.fuelshiftsystem.tankwidget.REFRESH_NOTIFICATIONS"
    }
}
