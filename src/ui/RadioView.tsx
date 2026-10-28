import { useEffect, useRef, useState } from "react";
import { artworkUrl } from "../api.js";
import type { AppSnapshot, MusicApplication } from "../contracts.js";
import { Icon } from "./Icon.js";
import { TrackRow } from "./TrackRow.js";

export function RadioView({ app, snapshot }: { app: MusicApplication; snapshot: AppSnapshot }) {
  const [query, setQuery] = useState(snapshot.catalog.trackQuery);
  const [composing, setComposing] = useState(false);
  const [revision, setRevision] = useState(0);
  const issued = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const { navigation, catalog, requests } = snapshot;
  const active =
    navigation.view === "browse" ||
    (navigation.mobile && navigation.view === "player" && navigation.mobilePage === "browse");
  const stale = query !== catalog.trackQuery;
  const searching = !!query.trim();

  useEffect(() => {
    if (!active || composing || issued.current === revision) return;
    const run = () => {
      if (issued.current === revision) return;
      issued.current = revision;
      void app.searchTracks(query);
    };
    if (!query.trim()) {
      run();
      return;
    }
    const timer = window.setTimeout(run, 280);
    return () => window.clearTimeout(timer);
  }, [app, query, composing, revision, active]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [catalog.trackQuery]);

  return (
    <section
      id="browse-view"
      className="search-view"
      aria-label="推荐电台与歌曲搜索"
      hidden={navigation.view !== "browse"}
    >
      <form
        id="track-search"
        className="search-field"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (!composing) {
            issued.current = revision;
            void app.searchTracks(query);
          }
        }}
      >
        <Icon name="search" />
        <input
          id="track-search-input"
          type="search"
          placeholder="想听什么歌？"
          aria-label="搜索歌曲"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            app.cancelTrackSearch();
            setQuery(event.currentTarget.value);
            setRevision((value) => value + 1);
          }}
          onCompositionStart={() => {
            app.cancelTrackSearch();
            setComposing(true);
          }}
          onCompositionEnd={(event) => {
            setComposing(false);
            setQuery(event.currentTarget.value);
            setRevision((value) => value + 1);
          }}
        />
        <button type="submit" className="icon-button small" aria-label="搜索歌曲">
          <Icon name="arrowRight" />
        </button>
      </form>
      <div
        ref={list}
        id={searching ? "track-results" : "radio-results"}
        className="artist-results"
        aria-label={searching ? "歌曲搜索结果" : "推荐电台"}
        aria-busy={searching && (requests.trackSearch || stale)}
      >
        {searching ? (
          stale || (requests.trackSearch && !catalog.tracks.length) ? (
            <p className="results-message">正在寻找歌曲…</p>
          ) : (
            <>
              {catalog.tracks.map((track) => (
                <TrackRow key={track.id} app={app} track={track} origin="search" />
              ))}
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
          )
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
    </section>
  );
}
