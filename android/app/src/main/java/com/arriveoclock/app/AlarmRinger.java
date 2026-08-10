package com.arriveoclock.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

import java.io.File;

/**
 * Plays the looping arrival alarm on the ALARM audio stream (so it is loud even
 * when notification/media volume is low, and bypasses notification silencing),
 * plus a repeating vibration. Owned by {@link AlarmActivity}.
 *
 * Plays the user's chosen song when one is set (see src/ringtone.js), and
 * ALWAYS falls back to the bundled tone if that file is missing or unplayable —
 * an alarm must never end up silent.
 */
final class AlarmRinger {
    /** "Gradually increase volume" ramp length — matches FADE_SEC in sound.js. */
    private static final long FADE_MS = 20000;
    private static final int FADE_STEPS = 40;
    private static final float FADE_FLOOR = 0.06f;

    private static MediaPlayer player;
    private static Vibrator vibrator;
    private static Handler fadeHandler;

    static Uri defaultUri(Context app) {
        return Uri.parse("android.resource://" + app.getPackageName() + "/raw/alarm");
    }

    /** Builds a prepared, looping player, or null if the source is unusable. */
    private static MediaPlayer open(Context app, String path, Uri uri) {
        MediaPlayer mp = new MediaPlayer();
        try {
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)   // routes to the alarm stream
                    .setContentType(path != null
                            ? AudioAttributes.CONTENT_TYPE_MUSIC
                            : AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            if (path != null) mp.setDataSource(path);
            else mp.setDataSource(app, uri);
            mp.setLooping(true);
            mp.prepare();
            return mp;
        } catch (Exception e) {
            try { mp.release(); } catch (Exception ignored) {}
            return null;
        }
    }

    static synchronized void start(Context context) {
        start(context, null, false);
    }

    /** Ramps the player from near-silent to full over {@link #FADE_MS}. */
    private static void startFade(final MediaPlayer mp) {
        mp.setVolume(FADE_FLOOR, FADE_FLOOR);
        fadeHandler = new Handler(Looper.getMainLooper());
        final long interval = FADE_MS / FADE_STEPS;
        fadeHandler.postDelayed(new Runnable() {
            private int step = 0;

            @Override
            public void run() {
                step++;
                // Bail out if this player was replaced or stopped meanwhile.
                if (player != mp) return;
                float v = Math.min(1f, FADE_FLOOR + ((float) step / FADE_STEPS) * (1f - FADE_FLOOR));
                try { mp.setVolume(v, v); } catch (Exception e) { return; }
                if (step < FADE_STEPS && fadeHandler != null) fadeHandler.postDelayed(this, interval);
            }
        }, interval);
    }

    static synchronized void start(Context context, String soundPath, boolean fadeIn) {
        stop();
        Context app = context.getApplicationContext();
        try {
            AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                am.setStreamVolume(AudioManager.STREAM_ALARM, max, 0);
            }

            MediaPlayer mp = null;
            if (soundPath != null && !soundPath.isEmpty()) {
                File f = new File(soundPath);
                if (f.exists() && f.canRead()) mp = open(app, f.getAbsolutePath(), null);
            }
            if (mp == null) mp = open(app, null, defaultUri(app)); // bundled fallback
            if (mp != null) {
                player = mp;
                if (fadeIn) startFade(mp);   // must be set before start()
                mp.start();
            }
        } catch (Exception e) {
            // Audio failed entirely — vibration below still provides feedback.
        }
        try {
            vibrator = (Vibrator) app.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = { 0, 600, 400, 600, 400 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception e) {
            // ignore
        }
    }

    static synchronized void stop() {
        if (fadeHandler != null) {
            try { fadeHandler.removeCallbacksAndMessages(null); } catch (Exception ignored) {}
            fadeHandler = null;
        }
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
            vibrator = null;
        }
    }

    private AlarmRinger() {}
}
