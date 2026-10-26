package app.qmplay;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import java.lang.ref.WeakReference;

public class MainActivity extends Activity {
    private static WeakReference<MainActivity> current = new WeakReference<>(null);
    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean loaded;
    private int attempts;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        current = new WeakReference<>(this);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        // Keep content inside the actual system insets on Android 15 and later.
        getWindow().getDecorView().setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                    android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return android.view.WindowInsets.CONSUMED;
            }
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        getWindow().setStatusBarColor(Color.rgb(102, 94, 80));
        getWindow().setNavigationBarColor(Color.rgb(52, 61, 60));
        TextView loading = new TextView(this);
        loading.setText("qmplay\n\n正在打开音乐…");
        loading.setTextColor(Color.WHITE);
        loading.setGravity(android.view.Gravity.CENTER);
        setContentView(loading);
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
        setContentView(web);
        web.loadUrl(MusicService.origin() + "/bootstrap?token=" + MusicService.token);
    }

    public final class AndroidBridge {
        @JavascriptInterface public void playback(String title, String artist, boolean playing) {
            MusicService.updatePlayback(title, artist, playing);
        }
        @JavascriptInterface public void minimize() { runOnUiThread(() -> moveTaskToBack(true)); }
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
