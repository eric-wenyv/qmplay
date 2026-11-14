package app.qmplay;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.*;
import android.util.Log;
import java.io.*;
import java.net.*;
import java.security.SecureRandom;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.zip.*;

public class MusicService extends Service {
    static volatile boolean ready;
    static volatile String failure;
    static String token;
    static int port;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final int NOTIFICATION_ID = 1;
    private static final int ARTWORK_SIZE = 256;
    private static MusicService instance;
    private MediaSession media;
    private PendingIntent openPlayer;
    private PowerManager.WakeLock wake;
    private boolean started;
    private final ExecutorService artworkLoader = Executors.newSingleThreadExecutor();
    private Future<?> artworkLoad;
    private int artworkRequest;
    private Bitmap artwork;
    private String artworkPath = "";
    private String trackId = "", title = "", artist = "", album = "";
    private long duration;
    private PlaybackState playbackState;
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
        openPlayer = PendingIntent.getActivity(this, 0,
            new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        media = new MediaSession(this, "qmplay");
        media.setSessionActivity(openPlayer);
        media.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MainActivity.dispatch("play"); }
            @Override public void onPause() { MainActivity.dispatch("pause"); }
            @Override public void onSkipToPrevious() { MainActivity.dispatch("previous"); }
            @Override public void onSkipToNext() { MainActivity.dispatch("next"); }
            @Override public void onSeekTo(long position) { MainActivity.seek(position); }
        });
        wake = ((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "qmplay:playback");
        wake.setReferenceCounted(false);
        startForeground(NOTIFICATION_ID, notification(false));
    }

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent != null && intent.getAction() != null) MainActivity.dispatch(intent.getAction());
        if (!started) {
            started = true;
            new Thread(this::launch, "qmplay-runtime").start();
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
            System.loadLibrary("qmplay");
            new Thread(() -> {
                try {
                    for (int attempt = 0; attempt < 500; attempt++) {
                        HttpURLConnection connection = (HttpURLConnection)new URL(origin() + "/index.html").openConnection();
                        connection.setRequestProperty("Cookie", "qmplay_local=" + token);
                        connection.setConnectTimeout(200); connection.setReadTimeout(500);
                        try { if (connection.getResponseCode() == 200) { ready = true; return; } }
                        catch (IOException ignored) {} finally { connection.disconnect(); }
                        Thread.sleep(100);
                    }
                    failure = "本地音乐服务连接超时";
                } catch (Exception error) { failure = "无法连接音乐服务"; }
            }, "qmplay-ready").start();
            int result = startNode(new File(runtime, "server.cjs").getPath(), new File(runtime, "web").getPath(), new File(getFilesDir(), "auth").getPath(), port, token);
            failure = "音乐服务已退出（" + result + "）";
        } catch (Throwable error) {
            Log.e("qmplay", "Runtime startup failed", error);
            failure = error.getClass().getSimpleName();
        }
    }

    private PendingIntent action(String name) {
        return PendingIntent.getService(this, name.hashCode(), new Intent(this, MusicService.class).setAction(name), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification notification(boolean playing) {
        return new Notification.Builder(this, "playback")
            .setSmallIcon(R.drawable.notification).setLargeIcon(artwork)
            .setContentTitle(trackId.isEmpty() ? "qmplay" : title)
            .setContentText(trackId.isEmpty() ? "音乐播放器" : artist)
            .setContentIntent(openPlayer).setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true)
            .setOngoing(playing)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "上一首", action("previous")).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "暂停" : "播放", action(playing ? "pause" : "play")).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "下一首", action("next")).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(media.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }

    static void updatePlayback(String id, String title, String artist, String album,
            String artwork, boolean playing, long position, long duration) {
        MAIN.post(() -> {
            if (instance != null)
                instance.publishPlayback(id, title, artist, album, artwork, playing, position, duration);
        });
    }

    private void publishPlayback(String id, String title, String artist, String album,
            String cover, boolean playing, long position, long duration) {
        boolean hasTrack = !id.isEmpty();
        boolean artworkChanged = !Objects.equals(cover, artworkPath);
        boolean trackChanged = !id.equals(trackId) || !Objects.equals(title, this.title)
            || !Objects.equals(artist, this.artist) || !Objects.equals(album, this.album) || artworkChanged;
        boolean durationChanged = this.duration != duration;
        this.trackId = id;
        this.title = title;
        this.artist = artist;
        this.album = album;
        this.duration = duration;
        if (artworkChanged) loadArtwork(cover);
        if (trackChanged || durationChanged) publishMetadata();

        int state = !hasTrack ? PlaybackState.STATE_NONE
            : playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        boolean stateChanged = playbackState == null || state != playbackState.getState();
        long now = SystemClock.elapsedRealtime();
        if (stateChanged || trackChanged || durationChanged || positionChanged(position, now, playing)) {
            long actions = hasTrack ? PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SKIP_TO_NEXT : 0;
            if (hasTrack && duration > 0) actions |= PlaybackState.ACTION_SEEK_TO;
            playbackState = new PlaybackState.Builder().setActions(actions)
                .setState(state, hasTrack ? position : PlaybackState.PLAYBACK_POSITION_UNKNOWN,
                    state == PlaybackState.STATE_PLAYING ? 1f : 0f, now)
                .build();
            media.setPlaybackState(playbackState);
        }
        media.setActive(hasTrack);
        if (state == PlaybackState.STATE_PLAYING && !wake.isHeld()) wake.acquire();
        else if (state != PlaybackState.STATE_PLAYING && wake.isHeld()) wake.release();
        if (stateChanged || trackChanged) publishNotification();
    }

    private boolean positionChanged(long position, long now, boolean playing) {
        if (trackId.isEmpty()) return false;
        long previous = playbackState.getPosition();
        if (!playing) return position != previous;
        // Android extrapolates while playing. Update when seeking or correcting drift.
        long expected = previous + now - playbackState.getLastPositionUpdateTime();
        return Math.abs(position - expected) >= 500;
    }

    private void publishMetadata() {
        if (trackId.isEmpty()) {
            media.setMetadata(null);
            return;
        }
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, trackId)
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album);
        if (duration > 0) metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        if (artwork != null) metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        media.setMetadata(metadata.build());
    }

    private void publishNotification() {
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID,
            notification(playbackState.getState() == PlaybackState.STATE_PLAYING));
    }

    private void loadArtwork(String cover) {
        artworkPath = cover;
        artwork = null;
        int request = ++artworkRequest;
        if (artworkLoad != null) artworkLoad.cancel(true);
        if (cover == null || !cover.startsWith("./art?url=")) return;
        artworkLoad = artworkLoader.submit(() -> {
            Bitmap loaded = fetchArtwork(cover);
            if (loaded == null) return;
            MAIN.post(() -> {
                if (instance != this || request != artworkRequest) return;
                artwork = loaded;
                publishMetadata();
                publishNotification();
            });
        });
    }

    private Bitmap fetchArtwork(String cover) {
        // Use the local proxy's QQ image allowlist and bounded response.
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection)new URL(origin() + cover.substring(1)).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(12000);
            connection.setRequestProperty("Cookie", "qmplay_local=" + token);
            if (connection.getResponseCode() != 200) return null;
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) { copy(input, bytes); }
            byte[] image = bytes.toByteArray();
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(image, 0, image.length, options);
            options.inSampleSize = 1;
            while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > ARTWORK_SIZE)
                options.inSampleSize *= 2;
            options.inJustDecodeBounds = false;
            return BitmapFactory.decodeByteArray(image, 0, image.length, options);
        } catch (IOException error) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onTaskRemoved(Intent root) { stopSelf(); android.os.Process.killProcess(android.os.Process.myPid()); }
    @Override public void onDestroy() {
        instance = null;
        artworkLoader.shutdownNow();
        media.release();
        if (wake.isHeld()) wake.release();
        super.onDestroy();
    }
}
