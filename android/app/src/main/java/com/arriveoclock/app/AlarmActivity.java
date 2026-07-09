package com.arriveoclock.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen alarm screen. Launched over the lock screen via a full-screen
 * intent (and directly when the screen is already on). Turns the screen on,
 * shows above the keyguard, and rings via {@link AlarmRinger} until dismissed.
 */
public class AlarmActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable autoStop;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String title = getIntent().getStringExtra("title");
        String body = getIntent().getStringExtra("body");
        if (title == null) title = "Almost there";
        if (body == null) body = "You're arriving at your stop.";

        setContentView(buildView(title, body));
        // The notification is already ringing (insistent alarm sound). Cancel it
        // so we hand the ringing off to AlarmRinger cleanly instead of doubling.
        try { AlarmReceiver.cancelNotification(this); } catch (Exception ignored) {}
        AlarmRinger.start(this);

        // Safety net: never ring forever.
        autoStop = this::dismiss;
        handler.postDelayed(autoStop, 120000);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        // Re-trigger from a second fire while already showing — keep ringing.
        AlarmRinger.start(this);
    }

    private View buildView(String title, String body) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#0a0a0a"));
        int pad = dp(28);
        root.setPadding(pad, pad, pad, pad);

        TextView kicker = new TextView(this);
        kicker.setText("ARRIVING SOON");
        kicker.setTextColor(Color.parseColor("#9a9a9a"));
        kicker.setTextSize(13);
        kicker.setLetterSpacing(0.18f);
        kicker.setGravity(Gravity.CENTER);
        root.addView(kicker);

        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(Color.WHITE);
        t.setTextSize(30);
        t.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tlp.topMargin = dp(12);
        root.addView(t, tlp);

        TextView b = new TextView(this);
        b.setText(body);
        b.setTextColor(Color.parseColor("#c8c8c8"));
        b.setTextSize(16);
        b.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        blp.topMargin = dp(10);
        root.addView(b, blp);

        Button stop = new Button(this);
        stop.setText("Stop alarm");
        stop.setAllCaps(false);
        stop.setTextColor(Color.parseColor("#0a0a0a"));
        stop.setBackgroundColor(Color.WHITE);
        stop.setOnClickListener(v -> dismiss());
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
        slp.topMargin = dp(40);
        root.addView(stop, slp);

        return root;
    }

    private void dismiss() {
        AlarmRinger.stop();
        if (autoStop != null) handler.removeCallbacks(autoStop);
        try { AlarmReceiver.cancelNotification(this); } catch (Exception ignored) {}
        finish();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        AlarmRinger.stop();
        if (autoStop != null) handler.removeCallbacks(autoStop);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
