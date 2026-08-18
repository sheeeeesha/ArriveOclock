package com.arriveoclock.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

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

    private Intent receiverIntent(Context ctx, String title, String body, String sound, boolean fadeIn) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.putExtra("title", title);
        i.putExtra("body", body);
        // Absolute path to the user's chosen song, or null for the bundled tone.
        i.putExtra("sound", sound);
        // "Gradually increase volume" — ramps the full-screen alarm's player.
        i.putExtra("fadeIn", fadeIn);
        return i;
    }

    @PluginMethod
    public void set(PluginCall call) {
        Double atD = call.getDouble("at");
        long at = atD == null ? System.currentTimeMillis() : (long) (double) atD;
        String title = call.getString("title", "Almost there");
        String body = call.getString("body", "You're arriving at your stop.");
        String sound = call.getString("sound", null);
        boolean fadeIn = Boolean.TRUE.equals(call.getBoolean("fadeIn", false));
        Context ctx = getContext();

        Intent i = receiverIntent(ctx, title, body, sound, fadeIn);
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
        if (am != null) am.cancel(operation(ctx, receiverIntent(ctx, "", "", null, false)));
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

    // -----------------------------------------------------------------------
    // Alarm-reliability permissions.
    //
    // Every one of these fails with the SAME symptom — the alarm doesn't ring —
    // so the app needs to report them individually instead of leaving the user
    // to guess. Kept on this plugin because they all exist to make the alarm
    // fire; none is meaningful to the app on its own.
    // -----------------------------------------------------------------------

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
                == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void permissions(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();

        r.put("fineLocation", granted(Manifest.permission.ACCESS_FINE_LOCATION));

        // Below Android 10 there is no separate background-location permission —
        // foreground access already covers it.
        r.put("backgroundLocation", Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION));

        boolean notifs;
        try { notifs = NotificationManagerCompat.from(ctx).areNotificationsEnabled(); }
        catch (Exception e) { notifs = true; }
        r.put("notifications", notifs);

        // The OEM killer: without this, Xiaomi/Samsung/OnePlus/Oppo/Vivo/Realme
        // stop the tracking service and no fixes arrive.
        boolean battery = true;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                battery = pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
            }
        } catch (Exception e) { /* assume fine rather than nag wrongly */ }
        r.put("batteryUnrestricted", battery);

        boolean exact = true;
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                exact = am.canScheduleExactAlarms();
            }
        } catch (Exception e) { /* ignore */ }
        r.put("exactAlarms", exact);

        call.resolve(r);
    }

    /** Opens the specific settings page for one requirement, not a generic dump. */
    @PluginMethod
    public void openSetting(PluginCall call) {
        String target = call.getString("target", "app");
        Context ctx = getContext();
        Uri self = Uri.fromParts("package", ctx.getPackageName(), null);
        Intent i;

        switch (target == null ? "app" : target) {
            case "notifications":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                } else {
                    i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, self);
                }
                break;
            case "battery":
                // The battery-optimisation LIST (no special permission needed).
                // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is Play-restricted.
                i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                break;
            case "exactAlarm":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, self);
                } else {
                    i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, self);
                }
                break;
            case "app":
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, self);
                break;
        }

        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            // Some OEMs lack the specific screen — fall back to app details.
            try {
                ctx.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, self)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                call.resolve();
            } catch (Exception e2) {
                call.reject("Could not open settings");
            }
        }
    }
}
