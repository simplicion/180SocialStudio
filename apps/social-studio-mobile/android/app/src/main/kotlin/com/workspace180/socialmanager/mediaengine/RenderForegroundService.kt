package com.workspace180.socialmanager.mediaengine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.workspace180.social_studio_mobile.R
import kotlin.math.roundToInt

/**
 * Keeps the process in the foreground while renders run, so moving the app to the background
 * does not get the export killed. The service does no work itself: [MediaEnginePlugin] runs the
 * Media3 export and reports progress here. Cancellation still goes through `cancelRender`.
 *
 * All companion functions must be called on the main thread.
 */
class RenderForegroundService : Service() {
    companion object {
        private const val TAG = "RenderFgService"
        private const val CHANNEL_ID = "media_render"
        private const val NOTIFICATION_ID = 0x180E

        private var instance: RenderForegroundService? = null
        private var wanted = false
        private var progress: Double? = null
        private var activeJobs = 0
        private var shownPercent = -1

        /** Starts (or keeps) the service for [jobs] running renders. */
        fun start(context: Context, jobs: Int) {
            wanted = true
            activeJobs = jobs
            if (instance != null) {
                instance?.refresh()
                return
            }
            val intent = Intent(context, RenderForegroundService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            } catch (e: Exception) {
                // e.g. ForegroundServiceStartNotAllowedException when started from the background.
                // The render still runs; it is just not protected from being killed.
                Log.w(TAG, "Could not start render foreground service", e)
            }
        }

        /** Updates the notification with the overall progress (0..1) of [jobs] running renders. */
        fun update(jobs: Int, overallProgress: Double) {
            activeJobs = jobs
            progress = overallProgress
            val percent = (overallProgress * 100).roundToInt().coerceIn(0, 100)
            if (percent == shownPercent) return
            instance?.refresh()
        }

        private const val COMPLETION_CHANNEL_ID = "media_render_complete"
        private const val NOTIFICATION_ID_COMPLETE = 0x180F

        /** Notifies the creator that a video finished exporting. */
        fun notifySuccess(context: Context, outputPath: String) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) {
                if (nm.getNotificationChannel(COMPLETION_CHANNEL_ID) == null) {
                    nm.createNotificationChannel(
                        NotificationChannel(COMPLETION_CHANNEL_ID, "Video export completions", NotificationManager.IMPORTANCE_HIGH).apply {
                            description = "Notifications when video rendering finishes"
                            enableVibration(true)
                            setShowBadge(true)
                        }
                    )
                }
            }
            val builder = if (Build.VERSION.SDK_INT >= 26) {
                Notification.Builder(context, COMPLETION_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(context)
            }
            builder
                .setSmallIcon(R.drawable.ic_stat_render)
                .setContentTitle("🎬 Video export complete!")
                .setContentText("Your video is ready to view, share, or publish.")
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
                builder.setContentIntent(PendingIntent.getActivity(context, 1, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }
            nm.notify(NOTIFICATION_ID_COMPLETE, builder.build())
        }

        /** Notifies the creator that a video export encountered an error. */
        fun notifyFailure(context: Context, reason: String) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) {
                if (nm.getNotificationChannel(COMPLETION_CHANNEL_ID) == null) {
                    nm.createNotificationChannel(
                        NotificationChannel(COMPLETION_CHANNEL_ID, "Video export completions", NotificationManager.IMPORTANCE_HIGH).apply {
                            description = "Notifications when video rendering finishes"
                            enableVibration(true)
                            setShowBadge(true)
                        }
                    )
                }
            }
            val builder = if (Build.VERSION.SDK_INT >= 26) {
                Notification.Builder(context, COMPLETION_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(context)
            }
            builder
                .setSmallIcon(R.drawable.ic_stat_render)
                .setContentTitle("⚠️ Video export failed")
                .setContentText(reason.take(120))
                .setAutoCancel(true)
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
                builder.setContentIntent(PendingIntent.getActivity(context, 2, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }
            nm.notify(NOTIFICATION_ID_COMPLETE, builder.build())
        }

        /** Stops the service once no render is running. */
        fun stop() {
            wanted = false
            progress = null
            activeJobs = 0
            instance?.finish()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // startForeground must follow startForegroundService even if the renders already finished.
        try {
            val notification = buildNotification()
            when {
                Build.VERSION.SDK_INT >= 35 ->
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING)
                Build.VERSION.SDK_INT >= 29 ->
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                else -> startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.w(TAG, "startForeground failed", e)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!wanted) finish()
        return START_NOT_STICKY
    }

    /** Android 15+ ends media-processing services after their daily time budget. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "Foreground service time limit reached; render continues unprotected")
        finish()
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        shownPercent = -1
        super.onDestroy()
    }

    private fun refresh() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun finish() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Video exports", NotificationManager.IMPORTANCE_LOW).apply {
                        description = "Progress of videos being exported on this device"
                        setShowBadge(false)
                    },
                )
            }
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val p = progress
        val percent = p?.let { (it * 100).roundToInt().coerceIn(0, 100) }
        shownPercent = percent ?: -1
        val title = if (activeJobs > 1) {
            "Exporting $activeJobs videos" + (percent?.let { " ($it%)" } ?: "")
        } else {
            if (percent != null) "Exporting video ($percent%)" else "Exporting video"
        }
        builder
            .setSmallIcon(R.drawable.ic_stat_render)
            .setContentTitle(title)
            .setContentText(if (percent == null) "Preparing on-device render…" else "Processing in background… Safe to switch apps.")
            .setProgress(100, percent ?: 0, percent == null)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        }
        if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return builder.build()
    }
}
