package com.arriveoclock.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for the native arrival alarm.
 *   Alarm.set({ at, title, body })  schedule (or fire now) the full-screen alarm
 *   Alarm.cancel()                  cancel the pending alarm + stop any ringing
 *   Alarm.stop()                    stop ringing only
 *
 * Uses setAlarmClock() (highest-priority exact alarm, exempt from Doze) so it
 * fires precisely even when the app is killed or the phone is asleep.
 */
@CapacitorPlugin(name = "Alarm")
public class AlarmPlugin extends Plugin {
    private static final int REQ = 9090;

    private PendingIntent operation(Context ctx, Intent i) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, REQ, i, flags);
    }

    private Intent receiverIntent(Context ctx, String title, String body, String sound) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.putExtra("title", title);
        i.putExtra("body", body);
        // Absolute path to the user's chosen song, or null for the bundled tone.
        i.putExtra("sound", sound);
        return i;
    }

    @PluginMethod
    public void set(PluginCall call) {
        Double atD = call.getDouble("at");
        long at = atD == null ? System.currentTimeMillis() : (long) (double) atD;
        String title = call.getString("title", "Almost there");
        String body = call.getString("body", "You're arriving at your stop.");
        String sound = call.getString("sound", null);
        Context ctx = getContext();

        Intent i = receiverIntent(ctx, title, body, sound);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) { call.resolve(); return; }

        long now = System.currentTimeMillis();
        if (at <= now + 500) {
            am.cancel(operation(ctx, i)); // drop any earlier pending schedule
            ctx.sendBroadcast(i);          // fire immediately
            call.resolve();
            return;
        }

        PendingIntent op = operation(ctx, i);
        try {
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent show = PendingIntent.getActivity(ctx, REQ + 1, new Intent(ctx, AlarmActivity.class), flags);

            boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
            if (canExact) {
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), op);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, at, op);
            }
        } catch (Exception e) {
            try { am.set(AlarmManager.RTC_WAKEUP, at, op); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Context ctx = getContext();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(operation(ctx, receiverIntent(ctx, "", "", null)));
        AlarmReceiver.cancelNotification(ctx);
        AlarmRinger.stop();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        AlarmRinger.stop();
        AlarmReceiver.cancelNotification(getContext());
        call.resolve();
    }
}
