package app.qmplay;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.DisplayCutout;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.lang.ref.WeakReference;

public class MainActivity extends Activity {
    private static WeakReference<MainActivity> current = new WeakReference<>(null);
    private FrameLayout content;
    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile int topInset;
    private boolean loaded;
    private int attempts;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        current = new WeakReference<>(this);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attrs);
        }
        if (Build.VERSION.SDK_INT >= 29) getWindow().setStatusBarContrastEnforced(false);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        content = new FrameLayout(this);
        getWindow().getDecorView().setOnApplyWindowInsetsListener((view, insets) -> applyInsets(insets));
        TextView loading = new TextView(this);
        loading.setText("qmplay\n\n正在打开音乐…");
        loading.setTextColor(Color.WHITE);
        loading.setGravity(android.view.Gravity.CENTER);
        content.addView(loading);
        setContentView(content);
        startForegroundService(new Intent(this, MusicService.class));
        handler.post(new Runnable() {
            @Override public void run() {
                if (isFinishing() || isDestroyed()) return;
                if (MusicService.failure != null) {
                    loading.setText("音乐服务启动失败\n" + MusicService.failure);
                } else if (MusicService.ready) openPlayer();
                else if (++attempts < 600) handler.postDelayed(this, 100);
                else loading.setText("音乐服务启动超时，请重新打开应用");
            }
        });
    }

    private WindowInsets applyInsets(WindowInsets insets) {
        int left, top, right, bottom;
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            left = safe.left;
            top = safe.top;
            right = safe.right;
            bottom = safe.bottom;
        } else {
            left = insets.getSystemWindowInsetLeft();
            top = insets.getSystemWindowInsetTop();
            right = insets.getSystemWindowInsetRight();
            bottom = insets.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cutout = insets.getDisplayCutout();
                if (cutout != null) {
                    left = Math.max(left, cutout.getSafeInsetLeft());
                    top = Math.max(top, cutout.getSafeInsetTop());
                    right = Math.max(right, cutout.getSafeInsetRight());
                    bottom = Math.max(bottom, cutout.getSafeInsetBottom());
                }
            }
        }
        // The WebView draws behind the status bar. CSS insets the page content inside it.
        content.setPadding(left, 0, right, bottom);
        int topDp = (int) Math.ceil(top / getResources().getDisplayMetrics().density);
        if (topDp != topInset) {
            topInset = topDp;
            if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('qmplay-insets'))", null);
        }
        if (Build.VERSION.SDK_INT >= 30) return WindowInsets.CONSUMED;
        if (Build.VERSION.SDK_INT >= 28) insets = insets.consumeDisplayCutout();
        return insets.consumeSystemWindowInsets();
    }

    private void openPlayer() {
        if (loaded) return;
        loaded = true;
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(102, 94, 80));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(new AndroidBridge(), "qmplayAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(MusicService.origin() + "/");
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });
        content.removeAllViews();
        content.addView(web);
        web.loadUrl(MusicService.origin() + "/bootstrap?token=" + MusicService.token);
    }

    public final class AndroidBridge {
        @JavascriptInterface public int topInset() { return topInset; }
        @JavascriptInterface public void haptic(String effect) {
            if (effect == null) return;
            final int feedback;
            switch (effect) {
                case "wheel-key":
                    feedback = HapticFeedbackConstants.CONTEXT_CLICK;
                    break;
                case "play-key":
                    feedback = HapticFeedbackConstants.VIRTUAL_KEY;
                    break;
                case "cover-step":
                    feedback = Build.VERSION.SDK_INT >= 34
                        ? HapticFeedbackConstants.SEGMENT_FREQUENT_TICK : HapticFeedbackConstants.CLOCK_TICK;
                    break;
                default:
                    return;
            }
            runOnUiThread(() -> {
                if (web != null && !isFinishing() && !isDestroyed() && hasWindowFocus())
                    web.performHapticFeedback(feedback);
            });
        }
        @JavascriptInterface public void playback(String title, String artist, boolean playing) {
            MusicService.updatePlayback(title, artist, playing);
        }
        @JavascriptInterface public void minimize() { runOnUiThread(() -> moveTaskToBack(true)); }
        @JavascriptInterface public boolean openQqLogin(String url) {
            return QqLogin.open(MainActivity.this, url);
        }
    }

    static void dispatch(String action) {
        MainActivity activity = current.get();
        if (activity == null || activity.web == null) return;
        if (!java.util.Arrays.asList("play", "pause", "previous", "next").contains(action)) return;
        activity.runOnUiThread(() -> activity.web.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('qmplay-media',{detail:'" + action + "'}))", null));
    }

    private void handleBack() {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('qmplay-back'))", null);
        else moveTaskToBack(true);
    }
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (current.get() == this) current.clear();
        if (web != null) { web.removeJavascriptInterface("qmplayAndroid"); web.destroy(); }
        super.onDestroy();
    }
}
