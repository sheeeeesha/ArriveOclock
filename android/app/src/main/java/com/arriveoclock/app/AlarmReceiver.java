package com.arriveoclock.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

/**
 * Fired by AlarmManager (scheduled backstop) or an immediate sendBroadcast
 * (live fire while the app runs) at the predicted arrival time.
 *
 * The notification ITSELF rings — an insistent (looping) alarm-stream sound on
 * a high-importance channel — so it is audible in EVERY state: app killed, app
 * backgrounded, app in the foreground, screen locked or unlocked. Previously
 * the sound only started inside {@link AlarmActivity}, so whenever the phone
 * was unlocked (full-screen intent degrades to a silent heads-up and the
 * background activity launch is blocked) the alarm was completely silent. The
 * full-screen intent still launches {@link AlarmActivity} over the lock screen
 * for the dismiss UI; that activity cancels this notification and takes over the
 * ringing so the two never overlap.
 */
public class AlarmReceiver extends BroadcastReceiver {
    static final int NOTIF_ID = 7711;
    // v2: the previous channel (v1) was created with a null sound, and channel
    // settings are immutable once created, so a new id is required to make
    // already-installed apps ring.
    static final String CHANNEL_ID = "arrival_alarm_v2";
    static final String ACTION_STOP = "com.arriveoclock.app.ACTION_STOP_ALARM";

    @Override
    public void onReceive(Context context, Intent intent) {
        // "Stop" notification action (heads-up case, when no full-screen
        // activity is showing to dismiss from).
        if (ACTION_STOP.equals(intent.getAction())) {
            AlarmRinger.stop();
            cancelNotification(context);
            return;
        }

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

        Intent stop = new Intent(context, AlarmReceiver.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getBroadcast(context, 1002, stop, piFlags);

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
                .setFullScreenIntent(fullPi, true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi);

        // Pre-O has no notification channels, so the sound rides on the builder.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            nb.setSound(alarmUri(context), AudioManager.STREAM_ALARM);
            nb.setDefaults(NotificationCompat.DEFAULT_VIBRATE);
        }

        Notification n = nb.build();
        // Loop the alarm sound until the notification is dismissed or handed off
        // to AlarmActivity — a single ding is not an alarm.
        n.flags |= Notification.FLAG_INSISTENT;

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, n);

        // Full-screen intents only auto-launch over the keyguard; if the screen
        // is already on/unlocked, try to start the alarm screen directly too.
        // If this is blocked (background-activity-start), the insistent
        // notification above still rings — that is the whole point of the fix.
        try {
            context.startActivity(full);
        } catch (Exception ignored) {
        }
    }

    private static Uri alarmUri(Context context) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/raw/alarm");
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            // Retire the old silent channel so it doesn't linger in settings.
            try { nm.deleteNotificationChannel("arrival_alarm_v1"); } catch (Exception ignored) {}
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "Arrival alarm", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Rings when you reach your stop");
                AudioAttributes aa = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                ch.setSound(alarmUri(context), aa);   // ring on the alarm stream
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{0, 600, 400, 600, 400});
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
