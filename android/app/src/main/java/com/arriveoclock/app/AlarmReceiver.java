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
import androidx.core.content.FileProvider;

import java.io.File;
import java.util.List;

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
 *
 * CUSTOM SONGS: a channel's sound is frozen when the channel is created, so the
 * channel id embeds the chosen sound — picking a new song creates a new channel
 * and retires the old one. If the song can't be exposed to the system for any
 * reason we fall back to the bundled tone: degraded, never silent.
 */
public class AlarmReceiver extends BroadcastReceiver {
    static final int NOTIF_ID = 7711;
    // v3: channel ids are now per-sound (see channelIdFor). Older ids (v1
    // silent, v2 fixed-sound) are deleted on sight.
    static final String CHANNEL_PREFIX = "arrival_alarm_v3_";
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
        String sound = intent.getStringExtra("sound");
        if (title == null) title = "Almost there";
        if (body == null) body = "You're arriving at your stop.";

        Uri soundUri = soundUriFor(context, sound);
        String channelId = ensureChannel(context, soundUri);

        Intent full = new Intent(context, AlarmActivity.class);
        full.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        full.putExtra("title", title);
        full.putExtra("body", body);
        full.putExtra("sound", sound);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullPi = PendingIntent.getActivity(context, 1001, full, piFlags);

        Intent stop = new Intent(context, AlarmReceiver.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getBroadcast(context, 1002, stop, piFlags);

        NotificationCompat.Builder nb = new NotificationCompat.Builder(context, channelId)
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
            nb.setSound(soundUri, AudioManager.STREAM_ALARM);
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

    private static Uri bundledUri(Context context) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/raw/alarm");
    }

    /**
     * A sound URI the SYSTEM (not just this app) can read. App-private files
     * must be shared through the FileProvider, with read access granted to the
     * system UI that actually plays notification audio.
     */
    private static Uri soundUriFor(Context context, String path) {
        if (path == null || path.isEmpty()) return bundledUri(context);
        try {
            File f = new File(path);
            if (!f.exists() || !f.canRead()) return bundledUri(context);
            Uri uri = FileProvider.getUriForFile(
                    context, context.getPackageName() + ".fileprovider", f);
            context.grantUriPermission("com.android.systemui", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            context.grantUriPermission("android", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return uri;
        } catch (Exception e) {
            // Path outside the FileProvider config, or no such file.
            return bundledUri(context);
        }
    }

    /** Channel id is derived from the sound, because channel sound is immutable. */
    private static String channelIdFor(Uri soundUri) {
        return CHANNEL_PREFIX + Integer.toHexString(String.valueOf(soundUri).hashCode());
    }

    static String ensureChannel(Context context, Uri soundUri) {
        String id = channelIdFor(soundUri);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return id;

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return id;

        // Retire superseded channels (old silent v1/v2, and previous ringtones)
        // so they don't pile up in system settings.
        try {
            nm.deleteNotificationChannel("arrival_alarm_v1");
            nm.deleteNotificationChannel("arrival_alarm_v2");
            List<NotificationChannel> existing = nm.getNotificationChannels();
            if (existing != null) {
                for (NotificationChannel c : existing) {
                    String cid = c.getId();
                    if (cid != null && cid.startsWith(CHANNEL_PREFIX) && !cid.equals(id)) {
                        nm.deleteNotificationChannel(cid);
                    }
                }
            }
        } catch (Exception ignored) {}

        if (nm.getNotificationChannel(id) == null) {
            NotificationChannel ch = new NotificationChannel(
                    id, "Arrival alarm", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Rings when you reach your stop");
            AudioAttributes aa = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            ch.setSound(soundUri, aa);   // ring on the alarm stream
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 600, 400, 600, 400});
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setBypassDnd(true);
            nm.createNotificationChannel(ch);
        }
        return id;
    }

    static void cancelNotification(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_ID);
    }
}
