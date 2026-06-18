package com.arriveoclock.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

/**
 * Fired by AlarmManager at the predicted arrival time. Posts a MAX-importance,
 * CATEGORY_ALARM notification with a full-screen intent so the system launches
 * {@link AlarmActivity} over the lock screen, then also tries to start it
 * directly to cover the screen-on/unlocked case.
 */
public class AlarmReceiver extends BroadcastReceiver {
    static final int NOTIF_ID = 7711;
    static final String CHANNEL_ID = "arrival_alarm_v1";

    @Override
    public void onReceive(Context context, Intent intent) {
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        if (title == null) title = "Almost there";
        if (body == null) body = "You're arriving at your stop.";

        ensureChannel(context);

        Intent full = new Intent(context, AlarmActivity.class);
        full.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        full.putExtra("title", title);
        full.putExtra("body", body);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullPi = PendingIntent.getActivity(context, 1001, full, piFlags);

        NotificationCompat.Builder nb = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(fullPi)
                .setFullScreenIntent(fullPi, true);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, nb.build());

        // Full-screen intents only auto-launch over the keyguard; if the screen
        // is already on/unlocked, start the alarm screen directly too.
        try {
            context.startActivity(full);
        } catch (Exception ignored) {
            // Background-activity-start may be blocked; the notification still rings.
        }
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "Arrival alarm", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Rings when you reach your stop");
                ch.setSound(null, null);          // audio handled by AlarmActivity (alarm stream)
                ch.enableVibration(false);        // vibration handled by AlarmRinger
                ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                ch.setBypassDnd(true);
                nm.createNotificationChannel(ch);
            }
        }
    }

    static void cancelNotification(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_ID);
    }
}
