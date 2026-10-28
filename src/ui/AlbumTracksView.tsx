import { useEffect, useRef } from "react";
import type { AppSnapshot, MusicApplication } from "../contracts.js";
import { Icon } from "./Icon.js";
import { TrackRow } from "./TrackRow.js";

export function AlbumTracksView({
  app,
  snapshot,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
}) {
  const list = useRef<HTMLDivElement>(null);
  const { album, albumTracks, hasMoreAlbumTracks } = snapshot.catalog;
  const loading = snapshot.requests.albumTracks;
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [album?.id]);
  return (
    <section
      id="album-tracks-view"
      className="search-view"
      aria-label="专辑歌曲"
      hidden={snapshot.navigation.view !== "albumTracks"}
    >
      <div className="browse-heading artist-summary">
        <button
          id="album-tracks-back"
          className="icon-button small"
          type="button"
          aria-label="返回专辑列表"
          onClick={() => app.returnToAlbums()}
        >
          <Icon name="arrowLeft" />
        </button>
        <h2>{album?.name}</h2>
        <button
          id="play-album"
          className="text-button"
          type="button"
          disabled={!album || !albumTracks.length}
          onClick={() => {
            if (album) void app.switchSource("album", album);
          }}
        >
          播放全部
        </button>
      </div>
      <div
        ref={list}
        id="album-track-results"
        className="artist-results"
        aria-label="专辑歌曲列表"
        aria-busy={loading}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.scrollHeight - node.scrollTop - node.clientHeight < 160)
            void app.loadMoreAlbumTracks();
        }}
      >
        {albumTracks.map((track) => (
          <TrackRow key={track.id} app={app} track={track} origin="album" />
        ))}
        {loading && !albumTracks.length && <p className="results-message">正在加载专辑歌曲…</p>}
        {!loading && !albumTracks.length && !hasMoreAlbumTracks && (
          <p className="results-message">这张专辑暂时没有歌曲</p>
        )}
        {hasMoreAlbumTracks && albumTracks.length > 0 && (
          <button
            className="text-button load-more"
            type="button"
            disabled={loading}
            onClick={() => void app.loadMoreAlbumTracks()}
          >
            {loading ? "正在加载…" : "加载更多歌曲"}
          </button>
        )}
      </div>
    </section>
  );
}
