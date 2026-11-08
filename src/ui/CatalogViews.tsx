import { useEffect, useRef, useState } from "react";
import { artworkUrl } from "../api.js";
import type { AppSnapshot, Artist, MusicApplication } from "../contracts.js";
import { Icon } from "./Icon.js";
import { TrackRow } from "./TrackRow.js";

function ArtistRow({ app, artist }: { app: MusicApplication; artist: Artist }) {
  return (
    <button
      className="artist-row"
      type="button"
      data-artist={artist.id}
      aria-label={`查看 ${artist.name} 的专辑`}
      onClick={() => void app.showArtistAlbums(artist)}
    >
      <span className="artist-avatar" aria-hidden="true">
        <img src={artworkUrl(artist.avatarUrl)} alt="" loading="lazy" />
      </span>
      <span className="artist-row-copy">
        <span className="artist-name">{artist.name}</span>
        <span className="artist-followers">
          {artist.followerCount === null ? "—" : artist.followerCount.toLocaleString("zh-CN")}{" "}
          人关注
        </span>
      </span>
    </button>
  );
}

export function SearchView({ app, snapshot }: { app: MusicApplication; snapshot: AppSnapshot }) {
  const [query, setQuery] = useState(snapshot.catalog.query);
  const [composing, setComposing] = useState(false);
  const [inputRevision, setInputRevision] = useState(0);
  const issuedRevision = useRef(0);
  const results = useRef<HTMLDivElement>(null);
  const previousView = useRef(snapshot.navigation.view);
  const active =
    snapshot.navigation.view === "search" ||
    (snapshot.navigation.mobile && snapshot.navigation.mobilePage === "search");
  useEffect(() => {
    if (
      snapshot.navigation.view === "search" &&
      previousView.current !== "search" &&
      snapshot.catalog.query === ""
    )
      setQuery("");
    previousView.current = snapshot.navigation.view;
  }, [snapshot.navigation.view, snapshot.catalog.query]);
  useEffect(() => {
    if (!active || composing || issuedRevision.current === inputRevision) return;
    const run = () => {
      if (issuedRevision.current === inputRevision) return;
      issuedRevision.current = inputRevision;
      void app.search(query);
    };
    if (!query.trim()) {
      run();
      return;
    }
    const timer = window.setTimeout(run, 280);
    return () => window.clearTimeout(timer);
  }, [app, query, composing, active, inputRevision]);
  const ids = snapshot.catalog.artists
    .filter((artist) => artist.followerCount === null)
    .map((artist) => artist.id)
    .join(",");
  useEffect(() => {
    if (
      snapshot.navigation.view !== "search" ||
      snapshot.requests.search ||
      !results.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting && entry.target instanceof HTMLElement) {
            observer.unobserve(entry.target);
            if (entry.target.dataset.artist)
              void app.loadFollowerCount(entry.target.dataset.artist);
          }
      },
      { root: results.current },
    );
    for (const row of results.current.querySelectorAll<HTMLElement>("[data-artist]")) {
      if (row.dataset.artist && ids.split(",").includes(row.dataset.artist)) observer.observe(row);
    }
    return () => observer.disconnect();
  }, [app, ids, snapshot.navigation.view, snapshot.catalog.query, snapshot.requests.search]);
  const stale = query !== snapshot.catalog.query;
  return (
    <section
      id="search-view"
      className="search-view"
      aria-label="搜索歌手"
      hidden={snapshot.navigation.view !== "search"}
    >
      <form
        id="artist-search"
        className="search-field"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (!composing) {
            issuedRevision.current = inputRevision;
            void app.search(query);
          }
        }}
      >
        <Icon name="search" />
        <input
          id="search-input"
          type="search"
          placeholder="想听谁的歌？"
          aria-label="搜索歌手"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            app.cancelSearch();
            setQuery(event.currentTarget.value);
            setInputRevision((revision) => revision + 1);
          }}
          onCompositionStart={() => {
            app.cancelSearch();
            setComposing(true);
          }}
          onCompositionEnd={(event) => {
            setComposing(false);
            setQuery(event.currentTarget.value);
            setInputRevision((revision) => revision + 1);
          }}
        />
        <button type="submit" className="icon-button small" aria-label="搜索">
          <Icon name="arrowRight" />
        </button>
      </form>
      <div
        ref={results}
        id="artist-results"
        className="artist-results"
        aria-label="歌手搜索结果"
        aria-busy={snapshot.requests.search || stale}
      >
        {snapshot.requests.search || stale ? (
          <p className="results-message">正在寻找声音…</p>
        ) : (
          snapshot.catalog.artists.map((artist) => (
            <ArtistRow key={artist.id} app={app} artist={artist} />
          ))
        )}
      </div>
      <div
        id="search-empty"
        className="search-empty"
        hidden={
          snapshot.requests.search || stale || !query.trim() || snapshot.catalog.artists.length > 0
        }
      >
        <Icon name="search" />
        <p>还没有找到这个声音</p>
      </div>
    </section>
  );
}

export function AlbumsView({ app, snapshot }: { app: MusicApplication; snapshot: AppSnapshot }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [snapshot.catalog.artist?.id]);
  const artist = snapshot.catalog.artist;
  return (
    <section
      id="albums-view"
      className="search-view"
      aria-label="歌手专辑"
      hidden={snapshot.navigation.view !== "albums"}
    >
      <div className="browse-heading artist-summary">
        <span className="artist-avatar">
          <img id="artist-summary-image" src={artworkUrl(artist?.avatarUrl || "")} alt="" />
        </span>
        <h2 id="artist-summary-name">{artist?.name}</h2>
        <button
          id="play-artist"
          className="text-button"
          type="button"
          aria-label={`播放 ${artist?.name || ""} 的所有歌曲`}
          disabled={!artist}
          onClick={() => {
            if (artist) void app.switchSource("artist", artist);
          }}
        >
          播放全部
        </button>
      </div>
      <div
        ref={list}
        id="album-results"
        className="artist-results"
        aria-label="歌手专辑"
        aria-busy={snapshot.requests.albums}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.scrollHeight - node.scrollTop - node.clientHeight < 160)
            void app.loadMoreAlbums();
        }}
      >
        {snapshot.catalog.albums.map((album) => (
          <button
            key={album.id}
            className="artist-row"
            type="button"
            data-album={album.id}
            aria-label={`查看 ${album.name} 的歌曲`}
            onClick={() => void app.showAlbumTracks(album)}
          >
            <span className="artist-avatar radio-avatar">
              <img src={artworkUrl(album.coverUrl)} alt="" loading="lazy" />
            </span>
            <span className="artist-row-copy">
              <span className="artist-name">{album.name}</span>
              <span className="artist-followers">{album.publishDate}</span>
            </span>
          </button>
        ))}
        {snapshot.requests.albums && <p className="results-message">正在加载专辑…</p>}
      </div>
    </section>
  );
}

export function FavoritesView({ app, snapshot }: { app: MusicApplication; snapshot: AppSnapshot }) {
  return (
    <section
      id="liked-view"
      className="search-view"
      aria-label="喜欢的音乐"
      hidden={snapshot.navigation.view !== "liked"}
    >
      <div className="browse-heading">
        <h2>喜欢的音乐</h2>
        <button
          id="play-liked"
          className="text-button"
          type="button"
          disabled={!snapshot.library.liked.length}
          onClick={() => void app.switchSource("liked")}
        >
          播放全部
        </button>
      </div>
      <div id="liked-results" className="artist-results" aria-label="收藏歌曲">
        {snapshot.library.liked.length ? (
          snapshot.library.liked.map((track) => (
            <TrackRow key={track.id} app={app} track={track} origin="liked" />
          ))
        ) : (
          <p className="results-message">留一首喜欢的歌给自己</p>
        )}
      </div>
    </section>
  );
}
