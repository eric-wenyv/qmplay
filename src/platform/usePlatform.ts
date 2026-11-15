import { useEffect, useLayoutEffect } from "react";
import { artworkUrl } from "../api.js";
import type { AppSnapshot, MusicApplication } from "../contracts.js";
import "./types.js";

export const mobileViewportQuery = "(max-width: 560px), (pointer: coarse) and (max-width: 1024px)";

/** Native APIs and page lifecycle are effects; the application itself has no DOM. */
export function usePlatform(
  app: MusicApplication,
  snapshot: AppSnapshot,
  goBack: (backgroundOnHome: boolean) => boolean,
) {
  useEffect(() => {
    const desktop = Boolean(window.qmplayDesktop);
    const android = Boolean(window.qmplayAndroid);
    document.documentElement.classList.toggle("desktop", desktop);
    document.body.classList.toggle("desktop", desktop);
    document.body.classList.toggle("android", android);
    const syncTopInset = () => {
      const top = window.qmplayAndroid?.topInset?.();
      if (top !== undefined) document.body.style.setProperty("--android-top-inset", `${top}px`);
    };
    window.addEventListener("qmplay-insets", syncTopInset);
    syncTopInset();
    const query = window.matchMedia(mobileViewportQuery);
    const resize = () => app.setMobile(!desktop && query.matches);
    resize();
    query.addEventListener("change", resize);
    let lastRefresh = 0;
    const refresh = () => {
      if (app.getSnapshot().auth.state !== "ready" || Date.now() - lastRefresh < 30000) return;
      lastRefresh = Date.now();
      void app.refreshFavorites();
    };
    const hide = () => {
      app.savePreferences();
      app.stop();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) void app.start();
    };
    const media = (event: Event) => {
      if (app.getSnapshot().auth.state !== "ready") return;
      const action: unknown = (event as CustomEvent<unknown>).detail;
      if (action === "play") void app.play();
      else if (action === "pause") app.pause();
      else if (action === "next" || action === "previous") void app.advance(action);
      else if (typeof action === "number" && Number.isFinite(action) && action >= 0)
        app.seek(action / 1000);
    };
    const back = () => {
      if (!goBack(true)) return;
      app.savePreferences();
      window.qmplayAndroid?.minimize();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("qmplay-media", media);
    window.addEventListener("qmplay-back", back);
    const timer = window.setInterval(
      () => {
        if (!document.hidden && app.getSnapshot().auth.state === "ready")
          void app.refreshFavorites();
      },
      5 * 60 * 1000,
    );
    void app.start();
    return () => {
      query.removeEventListener("change", resize);
      window.removeEventListener("qmplay-insets", syncTopInset);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("qmplay-media", media);
      window.removeEventListener("qmplay-back", back);
      window.clearInterval(timer);
      app.stop();
      document.documentElement.classList.remove("desktop");
      document.body.classList.remove("desktop", "android", "auth-gated");
      document.body.style.removeProperty("--android-top-inset");
    };
  }, [app, goBack]);

  useLayoutEffect(() => {
    document.body.classList.toggle(
      "auth-gated",
      snapshot.auth.state !== "checking" && snapshot.auth.state !== "ready",
    );
  }, [snapshot.auth.state]);

  useEffect(() => {
    if (!navigator.mediaSession) return;
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => {
        void app.play();
      },
      pause: () => app.pause(),
      previoustrack: () => {
        void app.advance("previous");
      },
      nexttrack: () => {
        void app.advance("next");
      },
      seekto: ({ seekTime }) => {
        if (seekTime !== undefined) app.seek(seekTime);
      },
      seekbackward: ({ seekOffset }) =>
        app.seek(app.getSnapshot().playback.elapsed - (seekOffset || 10)),
      seekforward: ({ seekOffset }) =>
        app.seek(app.getSnapshot().playback.elapsed + (seekOffset || 10)),
    };
    for (const [name, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(name as MediaSessionAction, (details) => {
          if (app.getSnapshot().auth.state === "ready") handler(details);
        });
      } catch {
        /* Available actions vary between the desktop and Android hosts. */
      }
    }
    return () => {
      for (const name of Object.keys(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(name as MediaSessionAction, null);
        } catch {
          /* Unsupported action. */
        }
      }
    };
  }, [app]);

  const { current, playing, elapsed } = snapshot.playback;
  useEffect(() => {
    document.title = current ? `${current.title} · qmplay` : "qmplay · QQ 音乐播放器";
    if (navigator.mediaSession && "MediaMetadata" in window) {
      navigator.mediaSession.metadata = current
        ? new MediaMetadata({
            title: current.title,
            artist: current.artist || "",
            album: current.album || "",
            artwork: current.coverUrl
              ? [{ src: artworkUrl(current.coverUrl), sizes: "500x500", type: "image/jpeg" }]
              : [],
          })
        : null;
    }
  }, [current?.id, current?.title, current?.artist, current?.album, current?.coverUrl]);
  useEffect(() => {
    if (navigator.mediaSession)
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);
  const positionMs = Number.isFinite(elapsed) && elapsed > 0 ? Math.round(elapsed * 1000) : 0;
  const duration = current?.duration || 0;
  const durationMs = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0;
  useEffect(() => {
    window.qmplayAndroid?.playback(
      current?.id || "",
      current?.title || "",
      current?.artist || "",
      current?.album || "",
      current?.coverUrl ? artworkUrl(current.coverUrl) : "",
      playing,
      positionMs,
      durationMs,
    );
  }, [
    current?.id,
    current?.title,
    current?.artist,
    current?.album,
    current?.coverUrl,
    playing,
    positionMs,
    durationMs,
  ]);
  useEffect(() => {
    if (navigator.mediaSession && Number.isFinite(duration) && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.max(0, Math.min(elapsed, duration)),
        });
      } catch {
        /* Unsupported position reporting. */
      }
    }
  }, [elapsed, duration]);
}
