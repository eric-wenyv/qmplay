import { useMemo, useSyncExternalStore } from "react";
import type { MusicApplication } from "../contracts.js";
import { usePlatform } from "../platform/usePlatform.js";
import { Navigation } from "./Navigation.js";
import { AuthView } from "./AuthView.js";
import { PlayerView, PlaybackControls } from "./PlayerView.js";
import { SearchView, AlbumsView, RadioView, FavoritesView } from "./CatalogViews.js";
import { LyricsView } from "./LyricsView.js";
import { QueuePanel } from "./QueuePanel.js";
import { useKeyboard } from "./useKeyboard.js";
import { useSwipe } from "./useSwipe.js";

/** React renders snapshots; application controllers own all music workflows. */
export function App({ app }: { app: MusicApplication }) {
  const snapshot = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  usePlatform(app, snapshot);
  useKeyboard(app, snapshot);
  const swipe = useSwipe(app);
  const { navigation, playback, catalog, library, requests } = snapshot;
  const desktopQueue = !navigation.mobile && navigation.queueOpen;
  const modalMenu = navigation.mobile && navigation.menuOpen;
  // Keep feature trees mounted while reusing their elements until consumed data changes.
  // A media timeupdate therefore never walks an unchanged catalogue or library.
  const navigationView = useMemo(
    () => <Navigation app={app} snapshot={snapshot} />,
    [
      app,
      navigation.view,
      navigation.mobile,
      navigation.mobileMode,
      navigation.menuOpen,
      navigation.queueOpen,
      snapshot.auth.state,
    ],
  );
  const authView = useMemo(() => <AuthView app={app} auth={snapshot.auth} />, [app, snapshot.auth]);
  const playerView = useMemo(
    () => <PlayerView app={app} snapshot={snapshot} />,
    [
      app,
      playback.current,
      playback.index,
      playback.source?.type,
      library.liked,
      library.busyIds,
      navigation.view,
      requests.source,
    ],
  );
  const searchView = useMemo(
    () => <SearchView app={app} snapshot={snapshot} />,
    [
      app,
      catalog.query,
      catalog.artists,
      navigation.view,
      navigation.mobile,
      navigation.mobilePage,
      requests.search,
    ],
  );
  const albumsView = useMemo(
    () => <AlbumsView app={app} snapshot={snapshot} />,
    [app, catalog.artist, catalog.albums, navigation.view, requests.albums],
  );
  const radioView = useMemo(
    () => <RadioView app={app} snapshot={snapshot} />,
    [app, catalog.stations, navigation.view],
  );
  const favoritesView = useMemo(
    () => <FavoritesView app={app} snapshot={snapshot} />,
    [app, library.liked, navigation.view],
  );
  const activeLyric =
    navigation.view === "lyrics"
      ? snapshot.lyrics.findLastIndex((line) => line.time <= playback.elapsed)
      : -1;
  const lyricsView = useMemo(
    () => <LyricsView app={app} snapshot={snapshot} />,
    [
      app,
      snapshot.lyrics,
      requests.lyrics,
      navigation.view,
      playback.current?.id,
      playback.current?.title,
      activeLyric,
    ],
  );
  const queue = useMemo(
    () => <QueuePanel app={app} snapshot={snapshot} />,
    [
      app,
      playback.queue,
      playback.index,
      playback.source?.type,
      playback.source?.resource?.id,
      navigation.mobile,
      navigation.view,
      navigation.queueOpen,
      snapshot.notice?.message,
    ],
  );
  const className = [
    "player",
    playback.playing && "is-playing",
    playback.loading && "is-buffering",
    navigation.view !== "player" && "is-searching",
    modalMenu && "is-menu-open",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <main
      className={className}
      aria-label="qmplay 音乐播放器"
      onErrorCapture={(event) => {
        if (
          event.target instanceof HTMLImageElement &&
          event.target.getAttribute("src") !== "./assets/coast.jpg"
        )
          event.target.src = "./assets/coast.jpg";
      }}
      onClick={(event) => {
        if (
          navigation.view !== "lyrics" ||
          navigation.queueOpen ||
          (event.target instanceof Element &&
            event.target.closest(
              "button, input, [role=button], #lyrics-title, .results-message, .mode-control, .window-controls, #notice, #queue-panel, #queue-backdrop",
            ))
        )
          return;
        app.returnToPlayer();
      }}
    >
      <div
        id="mode-backdrop"
        className="mode-backdrop"
        hidden={!modalMenu}
        onClick={() => app.setMenu(false)}
      />
      {navigationView}
      {authView}
      <section
        className="main-stage"
        aria-label="正在播放"
        aria-busy={snapshot.requests.source}
        inert={modalMenu || desktopQueue}
        {...swipe}
      >
        {playerView}
        {searchView}
        {albumsView}
        {radioView}
        {favoritesView}
        {lyricsView}
        {navigation.mobile && queue}
      </section>
      <PlaybackControls app={app} snapshot={snapshot} inert={modalMenu || desktopQueue} />
      <div
        id="notice"
        className="notice"
        role="status"
        hidden={!snapshot.notice}
        inert={modalMenu || desktopQueue}
      >
        <span id="notice-message">{snapshot.notice?.message}</span>
        <button
          id="notice-action"
          type="button"
          hidden={!snapshot.notice?.retry}
          onClick={() => {
            const retry = snapshot.notice?.retry;
            app.dismissNotice();
            void retry?.();
          }}
        >
          重试
        </button>
        <button
          id="dismiss-notice"
          type="button"
          aria-label="关闭提示"
          onClick={() => app.dismissNotice()}
        >
          ×
        </button>
      </div>
      <div
        id="queue-backdrop"
        className="queue-backdrop"
        hidden={!desktopQueue}
        onClick={() => app.closeQueue()}
      />
      {!navigation.mobile && queue}
      <div id="announcement" className="sr-only" aria-live="polite" role="status">
        {snapshot.announcement}
      </div>
    </main>
  );
}
