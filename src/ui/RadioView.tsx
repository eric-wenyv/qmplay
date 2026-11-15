import { useCallback, useEffect, useRef, useState } from "react";
import { artworkUrl } from "../api.js";
import type { AppSnapshot, MusicApplication, Track } from "../contracts.js";
import { Icon } from "./Icon.js";
import { TrackRow } from "./TrackRow.js";
import { TrackActions } from "./TrackActions.js";
import { SearchHistory } from "./SearchHistory.js";

export function RadioView({ app, snapshot }: { app: MusicApplication; snapshot: AppSnapshot }) {
  const [composing, setComposing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [actionTrack, setActionTrack] = useState<Track | null>(null);
  const issued = useRef(0);
  const edited = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { navigation, catalog, requests, library, playback } = snapshot;
  const mobile = navigation.mobile;
  const active = navigation.view === "browse" || (mobile && navigation.mobilePage === "browse");
  const query = catalog.trackSearchInput;
  const stale = query !== catalog.trackQuery;
  const searching = !!query.trim();
  const showHistory = searchFocused && !searching && (mobile || catalog.searchHistory.length > 0);
  const searchActive = searching || showHistory;

  const endSearchFocus = useCallback(() => {
    input.current?.blur();
    setSearchFocused(false);
  }, []);
  const runSearch = useCallback(
    (value: string, version: number) => {
      issued.current = version;
      void app.searchTracks(value).then(() => {
        const state = app.getSnapshot();
        if (
          edited.current === version &&
          state.navigation.view === "browse" &&
          state.catalog.trackSearchInput === value
        )
          endSearchFocus();
      });
    },
    [app, endSearchFocus],
  );
  useEffect(() => {
    if (!active || composing || !query.trim() || issued.current === revision) return;
    const timer = window.setTimeout(() => {
      if (edited.current === revision && issued.current !== revision) runSearch(query, revision);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [runSearch, query, composing, revision, active]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [catalog.trackQuery]);
  if (actionTrack && navigation.view !== "browse") setActionTrack(null);

  const row = (track: Track, origin: "search" | "liked") => (
    <TrackRow
      key={track.id}
      app={app}
      track={track}
      origin={origin}
      current={track.id === playback.current?.id}
      onMore={mobile ? setActionTrack : undefined}
    />
  );
  return (
    <section
      id="browse-view"
      className={`search-view${mobile ? " mobile-home" : ""}`}
      aria-label="音乐首页"
      data-search-active={searchActive}
      hidden={navigation.view !== "browse"}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Element) ||
          !event.relatedTarget.closest("#track-search-input, .search-history")
        )
          setSearchFocused(false);
      }}
    >
      <form
        id="track-search"
        className="search-field"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (!composing && searching) {
            if (issued.current !== revision || stale) runSearch(query, revision);
            else if (!requests.search && !requests.trackSearch) endSearchFocus();
          }
        }}
      >
        {searching ? (
          <button
            type="button"
            className="search-back"
            aria-label="返回首页"
            onClick={(event) => {
              event.currentTarget.blur();
              endSearchFocus();
              app.goBack();
            }}
          >
            <Icon name="arrowLeft" />
          </button>
        ) : (
          <Icon name="search" />
        )}
        <input
          id="track-search-input"
          ref={input}
          type="search"
          placeholder="搜索歌曲、歌手、专辑"
          aria-label="搜索歌曲、歌手、专辑"
          autoComplete="off"
          enterKeyHint="search"
          spellCheck={false}
          value={query}
          onFocus={() => setSearchFocused(true)}
          onChange={(event) => {
            setRevision(++edited.current);
            app.setTrackSearchInput(event.currentTarget.value);
          }}
          onCompositionStart={() => {
            setRevision(++edited.current);
            app.cancelTrackSearch();
            setComposing(true);
          }}
          onCompositionEnd={(event) => {
            setComposing(false);
            setRevision(++edited.current);
            app.setTrackSearchInput(event.currentTarget.value);
          }}
        />
      </form>
      <div className="browse-content">
        {searchActive && (
          <div
            ref={list}
            id={searching ? "track-results" : undefined}
            className="artist-results home-scroll browse-search-results"
            data-dock={!!playback.current}
            aria-label={searching ? "搜索结果" : "搜索历史"}
            aria-busy={searching && (requests.trackSearch || requests.search || stale)}
          >
            {searching ? (
              <>
                {!stale && catalog.query === query && catalog.artists.length > 0 && (
                  <div className="search-artists" aria-label="歌手搜索结果">
                    {catalog.artists.map((artist) => (
                      <button
                        type="button"
                        className="search-artist-card"
                        key={artist.id}
                        data-artist={artist.id}
                        aria-label={`查看 ${artist.name} 的专辑`}
                        onClick={() => void app.showArtistAlbums(artist)}
                      >
                        <img src={artworkUrl(artist.avatarUrl)} alt="" loading="lazy" />
                        <span>
                          <small>歌手</small>
                          <strong>{artist.name}</strong>
                        </span>
                        <Icon name="arrowRight" />
                      </button>
                    ))}
                  </div>
                )}
                {stale || (requests.trackSearch && !catalog.tracks.length) ? (
                  <p className="results-message">正在寻找好音乐…</p>
                ) : (
                  <>
                    {catalog.tracks.map((track) => row(track, "search"))}
                    {!catalog.tracks.length && !catalog.hasMoreTracks && (
                      <p className="results-message">没有找到歌曲，试试其他关键词</p>
                    )}
                    {catalog.hasMoreTracks && catalog.tracks.length > 0 && (
                      <button
                        className="text-button load-more"
                        type="button"
                        disabled={requests.trackSearch}
                        onClick={() => void app.loadMoreTracks()}
                      >
                        {requests.trackSearch ? "正在加载…" : "加载更多歌曲"}
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <SearchHistory
                app={app}
                queries={catalog.searchHistory}
                onEmpty={mobile ? () => input.current?.focus({ preventScroll: true }) : undefined}
                onSearch={(value) => {
                  const version = ++edited.current;
                  setRevision(version);
                  endSearchFocus();
                  runSearch(value, version);
                }}
              />
            )}
          </div>
        )}
        <div
          id="radio-results"
          className="artist-results home-scroll radio-home-results"
          aria-label="推荐与喜欢的音乐"
          aria-hidden={searchActive}
          inert={searchActive}
          hidden={searchActive && !mobile}
          onScroll={(event) => setCollapsed(event.currentTarget.scrollTop > 180)}
        >
          {mobile ? (
            <>
              <div
                className="station-shelf"
                aria-label="推荐电台"
                data-collapsed={collapsed}
                inert={collapsed}
              >
                {catalog.stations.slice(0, 2).map((station, index) => {
                  const selected =
                    playback.source?.type === "radio" &&
                    playback.source.resource?.id === station.id &&
                    !!playback.current;
                  const playing = selected && (playback.playing || playback.desiredPlaying);
                  return (
                    <button
                      key={station.id}
                      type="button"
                      className={`station-card station-${index}`}
                      data-station={station.id}
                      data-playing={playing}
                      aria-label={`${playing ? "暂停" : "播放"}${station.name}`}
                      onClick={() =>
                        selected ? app.togglePlay() : void app.switchSource("radio", station)
                      }
                    >
                      <span className="station-title">
                        {index === 0 ? (
                          <>
                            For
                            <br />
                            You
                          </>
                        ) : (
                          <>
                            Daily
                            <br />
                            30
                          </>
                        )}
                      </span>
                      <span className="station-art">
                        <img src={artworkUrl(station.coverUrl)} alt="" />
                      </span>
                      <span className="station-caption">
                        <strong>{index === 0 ? "猜你喜欢" : "每日30首"}</strong>
                        <span>{index === 0 ? "沉浸在你的音乐里" : "每天遇见新的喜欢"}</span>
                      </span>
                      <span className="station-play">
                        {playing ? (
                          <span className="mini-bars" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          <Icon name="play" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="favorites-heading">
                <h2>
                  喜欢的音乐 <span>{library.liked.length} 首</span>
                </h2>
                <button
                  id="home-play-liked"
                  type="button"
                  disabled={!library.liked.length}
                  onClick={() => void app.switchSource("liked")}
                >
                  <Icon name="play" />
                  播放全部
                </button>
              </div>
              <div className="home-favorites" aria-label="收藏歌曲">
                {library.liked.length ? (
                  library.liked.map((track) => row(track, "liked"))
                ) : (
                  <p className="results-message favorites-empty">
                    <Icon name="heart" />
                    <strong>把喜欢的声音留在这里</strong>
                    <span>听到心动的歌，轻点播放器上的爱心</span>
                  </p>
                )}
              </div>
            </>
          ) : (
            catalog.stations.map((station) => (
              <button
                key={station.id}
                type="button"
                className="artist-row"
                data-station={station.id}
                onClick={() => void app.switchSource("radio", station)}
              >
                <span className="artist-avatar radio-avatar">
                  <img src={artworkUrl(station.coverUrl)} alt="" loading="lazy" />
                </span>
                <span className="artist-row-copy">
                  <span className="artist-name">{station.name}</span>
                  <span className="artist-followers">{station.group}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      {actionTrack && (
        <TrackActions app={app} track={actionTrack} onClose={() => setActionTrack(null)} />
      )}
    </section>
  );
}
