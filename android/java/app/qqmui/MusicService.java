package app.qqmui;

import android.app.*;
import android.content.*;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.*;
import android.util.Log;
import java.io.*;
import java.net.*;
import java.security.SecureRandom;
import java.util.zip.*;

public class MusicService extends Service {
    static volatile boolean ready;
    static volatile String failure;
    static String token;
    static int port;
    private static MusicService instance;
    private MediaSession media;
    private PowerManager.WakeLock wake;
    private boolean started;
    private static native int startNode(String script, String web, String auth, int port, String token);
    static String origin() { return "http://127.0.0.1:" + port; }
    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[8192]; int length;
        while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
    }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("playback", "音乐播放", NotificationManager.IMPORTANCE_LOW));
        media = new MediaSession(this, "qqmui");
        media.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MainActivity.dispatch("play"); }
            @Override public void onPause() { MainActivity.dispatch("pause"); }
            @Override public void onSkipToPrevious() { MainActivity.dispatch("previous"); }
            @Override public void onSkipToNext() { MainActivity.dispatch("next"); }
        });
        wake = ((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "qqmui:playback");
        wake.setReferenceCounted(false);
        startForeground(1, notification("qqmui", "音乐播放器", false));
    }

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent != null && intent.getAction() != null) MainActivity.dispatch(intent.getAction());
        if (!started) {
            started = true;
            new Thread(this::launch, "qqmui-runtime").start();
        }
        return START_NOT_STICKY;
    }

    private void launch() {
        try {
            SharedPreferences preferences = getSharedPreferences("runtime", MODE_PRIVATE);
            token = preferences.getString("token", null);
            if (token == null) {
                byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
                StringBuilder value = new StringBuilder();
                for (byte b : bytes) value.append(String.format("%02x", b));
                token = value.toString();
                preferences.edit().putString("token", token).commit();
            }
            port = preferences.getInt("port", 0);
            if (port == 0) {
                try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) { port = socket.getLocalPort(); }
                preferences.edit().putInt("port", port).commit();
            }
            File runtime = new File(getFilesDir(), "runtime");
            String version;
            try (InputStream input = getAssets().open("runtime.sha256")) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream(); copy(input, bytes);
                version = bytes.toString("UTF-8");
            }
            File stamp = new File(runtime, ".version");
            String installed = stamp.exists() ? new String(java.nio.file.Files.readAllBytes(stamp.toPath()), java.nio.charset.StandardCharsets.UTF_8) : "";
            if (!version.equals(installed)) {
                runtime.mkdirs();
                try (ZipInputStream zip = new ZipInputStream(getAssets().open("runtime.zip"))) {
                    ZipEntry entry;
                    while ((entry = zip.getNextEntry()) != null) {
                        File file = new File(runtime, entry.getName());
                        if (!file.getCanonicalPath().startsWith(runtime.getCanonicalPath() + File.separator)) throw new IOException("Invalid runtime path");
                        if (entry.isDirectory()) file.mkdirs();
                        else {
                            file.getParentFile().mkdirs();
                            try (OutputStream output = new FileOutputStream(file)) { copy(zip, output); }
                        }
                    }
                }
                java.nio.file.Files.write(stamp.toPath(), version.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            System.loadLibrary("c++_shared");
            System.loadLibrary("node");
            System.loadLibrary("qqmui");
            new Thread(() -> {
                try {
                    for (int attempt = 0; attempt < 500; attempt++) {
                        HttpURLConnection connection = (HttpURLConnection)new URL(origin() + "/index.html").openConnection();
                        connection.setRequestProperty("Cookie", "qqmui_local=" + token);
                        connection.setConnectTimeout(200); connection.setReadTimeout(500);
                        try { if (connection.getResponseCode() == 200) { ready = true; return; } }
                        catch (IOException ignored) {} finally { connection.disconnect(); }
                        Thread.sleep(100);
                    }
                    failure = "本地音乐服务连接超时";
                } catch (Exception error) { failure = "无法连接音乐服务"; }
            }, "qqmui-ready").start();
            int result = startNode(new File(runtime, "server.cjs").getPath(), new File(runtime, "web").getPath(), new File(getFilesDir(), "auth").getPath(), port, token);
            failure = "音乐服务已退出（" + result + "）";
        } catch (Throwable error) {
            Log.e("qqmui", "Runtime startup failed", error);
            failure = error.getClass().getSimpleName();
        }
    }

    private PendingIntent action(String name) {
        return PendingIntent.getService(this, name.hashCode(), new Intent(this, MusicService.class).setAction(name), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification notification(String title, String artist, boolean playing) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, "playback")
            .setSmallIcon(R.drawable.notification).setContentTitle(title).setContentText(artist)
            .setContentIntent(open).setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true)
            .setOngoing(playing)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "上一首", action("previous")).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "暂停" : "播放", action(playing ? "pause" : "play")).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "下一首", action("next")).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(media.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }
    static void updatePlayback(String title, String artist, boolean playing) {
        MusicService service = instance;
        if (service == null) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            service.media.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, artist).build());
            service.media.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SKIP_TO_NEXT).setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1).build());
            service.media.setActive(true);
            if (playing && !service.wake.isHeld()) service.wake.acquire();
            else if (!playing && service.wake.isHeld()) service.wake.release();
            service.getSystemService(NotificationManager.class).notify(1, service.notification(title, artist, playing));
        });
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onTaskRemoved(Intent root) { stopSelf(); android.os.Process.killProcess(android.os.Process.myPid()); }
    @Override public void onDestroy() {
        instance = null;
        media.release();
        if (wake.isHeld()) wake.release();
        super.onDestroy();
    }
}
