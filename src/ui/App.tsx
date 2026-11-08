import { useMemo, useState, useSyncExternalStore } from "react";
import type { MusicApplication } from "../contracts.js";
import { usePlatform } from "../platform/usePlatform.js";
import { Navigation } from "./Navigation.js";
import { AuthView } from "./AuthView.js";
import { PlayerView, PlaybackControls } from "./PlayerView.js";
import { SearchView, AlbumsView, FavoritesView } from "./CatalogViews.js";
import { RadioView } from "./RadioView.js";
import { AlbumTracksView } from "./AlbumTracksView.js";
import { LyricsView } from "./LyricsView.js";
import { QueuePanel } from "./QueuePanel.js";
import { useKeyboard } from "./useKeyboard.js";

interface TrackPreview {
  index: number;
  id: string;
  playingIndex: number;
  playingId: string;
}

/** React renders snapshots; application controllers own all music workflows. */
export function App({ app }: { app: MusicApplication }) {
  const snapshot = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  usePlatform(app, snapshot);
  useKeyboard(app, snapshot);
  const { navigation, playback, catalog, library, requests } = snapshot;
  const desktopQueue = !navigation.mobile && navigation.queueOpen;
  const modalMenu = navigation.mobile && navigation.menuOpen;
  const controlsInert = modalMenu || desktopQueue || snapshot.auth.state !== "ready";
  const [preview, setPreview] = useState<TrackPreview | null>(null);
  const activePreview =
    preview &&
    navigation.mobile &&
    navigation.view === "player" &&
    snapshot.auth.state === "ready" &&
    playback.index === preview.playingIndex &&
    playback.current?.id === preview.playingId &&
    playback.queue[preview.index]?.id === preview.id
      ? preview.index
      : null;
  if (preview && activePreview === null) setPreview(null);
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
      requests.auth,
    ],
  );
  const authView = useMemo(() => <AuthView app={app} auth={snapshot.auth} />, [app, snapshot.auth]);
  const playerView = useMemo(
    () => (
      <PlayerView
        app={app}
        snapshot={snapshot}
        inert={controlsInert}
        selectedIndex={activePreview ?? playback.index}
        onPreview={(index) => {
          const track = playback.queue[index];
          setPreview(
            index !== playback.index && track && playback.current
              ? {
                  index,
                  id: track.id,
                  playingIndex: playback.index,
                  playingId: playback.current.id,
                }
              : null,
          );
        }}
      />
    ),
    [
      app,
      playback.current,
      navigation.mobile ? playback.queue : null,
      playback.index,
      activePreview,
      playback.source?.type,
      library.liked,
      library.busyIds,
      navigation.mobile,
      navigation.view,
      controlsInert,
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
  const albumTracksView = useMemo(
    () => <AlbumTracksView app={app} snapshot={snapshot} />,
    [
      app,
      catalog.album,
      catalog.albumTracks,
      catalog.hasMoreAlbumTracks,
      navigation.view,
      requests.albumTracks,
    ],
  );
  const radioView = useMemo(
    () => <RadioView app={app} snapshot={snapshot} />,
    [
      app,
      catalog.stations,
      catalog.trackQuery,
      catalog.tracks,
      catalog.hasMoreTracks,
      navigation,
      requests.trackSearch,
    ],
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
        inert={controlsInert}
      >
        {playerView}
        {searchView}
        {albumsView}
        {albumTracksView}
        {radioView}
        {favoritesView}
        {lyricsView}
        {navigation.mobile && queue}
      </section>
      <PlaybackControls
        app={app}
        snapshot={snapshot}
        inert={controlsInert}
        previewIndex={activePreview}
      />
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
