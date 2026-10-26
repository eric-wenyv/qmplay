import { memo, useEffect, useRef, type CSSProperties } from "react";
import { artworkUrl } from "../api.js";
import { formatTime, orderLabels } from "../player.js";
import type { AppSnapshot, MusicApplication, PlayOrder } from "../contracts.js";
import { Icon } from "./Icon.js";
import { useArtworkTheme } from "./useArtworkTheme.js";

export function PlayerView({ app, snapshot }: { app: MusicApplication; snapshot: AppSnapshot }) {
  const { current, index, source } = snapshot.playback;
  const image = useRef<HTMLImageElement>(null);
  const theme = useArtworkTheme();
  const cover = artworkUrl(current?.coverUrl || "");
  const liked = snapshot.library.liked.some((track) => track.id === current?.id);
  const busy = Boolean(current && snapshot.library.busyIds.includes(current.id));
  useEffect(() => {
    if (image.current) theme(image.current);
  }, [cover, theme]);
  return (
    <>
      <div
        id="listening-view"
        className="listening-view"
        hidden={snapshot.navigation.view !== "player" || !current}
      >
        <div
          id="album-art"
          className="album-art"
          data-art="original"
          role="button"
          tabIndex={current ? 0 : -1}
          aria-label="查看歌词"
          aria-controls="lyrics-view"
          aria-expanded={snapshot.navigation.view === "lyrics"}
          onClick={() => app.showLyrics()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              app.showLyrics();
            }
          }}
        >
          <img
            ref={image}
            id="cover-image"
            src={cover}
            alt={current?.coverUrl ? `${current.album || current.title} 封面` : "默认封面"}
            width="1024"
            height="1024"
            fetchPriority="high"
            draggable={false}
            onLoad={(event) => theme(event.currentTarget)}
          />
          <div className="art-light" aria-hidden="true" />
          <span className="cover-index" aria-hidden="true">
            {String(index + 1).padStart(2, "0")} —{" "}
            {
              { radio: "FM", liked: "LOVE", artist: "ARTIST", album: "ARTIST" }[
                source?.type || "radio"
              ]
            }
          </span>
        </div>
        <div className="track-meta">
          <div className="track-copy">
            <h1 id="track-title">{current?.title || "qmplay"}</h1>
            <p id="track-artist">
              <span id="track-singer">{current?.artist || ""}</span>
              <span id="track-album">
                {current?.album ? `${current.artist ? " · " : ""}${current.album}` : ""}
              </span>
            </p>
          </div>
          <button
            id="like-toggle"
            className="icon-button like-button"
            type="button"
            aria-label={liked ? "取消喜欢这首歌" : "喜欢这首歌"}
            aria-pressed={liked}
            aria-busy={busy}
            data-tip={liked ? "取消喜欢" : "喜欢"}
            disabled={!current || busy}
            onClick={() => void app.toggleLike()}
          >
            <Icon name="heart" />
          </button>
        </div>
      </div>
      <section
        id="empty-view"
        className="empty-view"
        aria-label="暂无歌曲"
        hidden={snapshot.navigation.view !== "player" || Boolean(current)}
      >
        <Icon name="heart" className="empty-heart icon-slot" />
        <p id="empty-message">
          {snapshot.requests.source
            ? "正在寻找好听的音乐…"
            : source?.type === "liked"
              ? "留一首喜欢的歌给自己"
              : "还没有歌曲，选择一个电台开始听"}
        </p>
        <button
          id="back-to-radio"
          className="text-button"
          type="button"
          hidden={snapshot.requests.source}
          onClick={() => void app.showRadio()}
        >
          去听电台 <Icon name="arrowRight" />
        </button>
      </section>
    </>
  );
}

export function PlaybackControls({
  app,
  snapshot,
  inert,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
  inert: boolean;
}) {
  const playback = snapshot.playback;
  const duration = playback.current?.duration || 0;
  const playing = playback.playing || playback.desiredPlaying;
  return (
    <footer className="player-footer" inert={inert}>
      <div className="timeline">
        <input
          id="seek"
          type="range"
          min="0"
          max={duration}
          value={Math.min(playback.elapsed, duration)}
          step="1"
          aria-label="播放进度"
          aria-valuetext={`${formatTime(playback.elapsed)} / ${formatTime(duration)}`}
          style={
            {
              "--progress": `${duration ? (playback.elapsed / duration) * 100 : 0}%`,
            } as CSSProperties
          }
          disabled={!playback.current}
          onChange={(event) => app.seek(Number(event.currentTarget.value))}
        />
        <div className="time-labels">
          <span id="elapsed">{formatTime(playback.elapsed)}</span>
          <span id="duration">{formatTime(duration)}</span>
        </div>
      </div>
      <TransportControls
        app={app}
        hasCurrent={Boolean(playback.current)}
        playing={playing}
        loading={playback.loading}
        order={playback.order}
        mobile={snapshot.navigation.mobile}
        queueOpen={
          snapshot.navigation.mobile
            ? snapshot.navigation.view === "queue"
            : snapshot.navigation.queueOpen
        }
      />
    </footer>
  );
}

const TransportControls = memo(function TransportControls({
  app,
  hasCurrent,
  playing,
  loading,
  order,
  mobile,
  queueOpen,
}: {
  app: MusicApplication;
  hasCurrent: boolean;
  playing: boolean;
  loading: boolean;
  order: PlayOrder;
  mobile: boolean;
  queueOpen: boolean;
}) {
  const label = loading ? "取消加载" : playing ? "暂停" : "播放";
  return (
    <div className="control-deck">
      <nav className="transport" aria-label="播放控制">
        <div
          className="click-wheel"
          onClick={(event) => {
            const target = event.target instanceof Element ? event.target.closest("button") : null;
            if (
              mobile &&
              event.detail > 0 &&
              target === document.activeElement &&
              target instanceof HTMLElement
            )
              target.blur();
          }}
        >
          <button
            id="order-toggle"
            className="icon-button side-control"
            type="button"
            aria-label={`播放顺序：${orderLabels[order]}`}
            data-tip={orderLabels[order]}
            onClick={() => app.cycleOrder()}
          >
            <Icon name={order} />
          </button>
          <button
            id="previous-track"
            className="icon-button skip-control"
            type="button"
            aria-label="上一首"
            data-tip="上一首"
            disabled={!hasCurrent}
            onClick={() => void app.advance("previous")}
          >
            <Icon name="previous" />
          </button>
          <button
            id="play-toggle"
            className="play-button"
            type="button"
            aria-label={label}
            aria-busy={loading}
            data-tip={`${label} / 空格`}
            disabled={!hasCurrent}
            onClick={() => app.togglePlay()}
          >
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <button
            id="next-track"
            className="icon-button skip-control"
            type="button"
            aria-label="下一首"
            data-tip="下一首"
            disabled={!hasCurrent}
            onClick={() => void app.advance("next")}
          >
            <Icon name="next" />
          </button>
          <button
            id="queue-toggle"
            className="icon-button side-control"
            type="button"
            aria-label="播放队列"
            aria-expanded={queueOpen}
            aria-controls="queue-panel"
            data-tip="播放队列"
            onClick={() => app.openQueue()}
          >
            <Icon name="queue" />
            <span id="queue-indicator" className="queue-indicator" />
          </button>
        </div>
      </nav>
    </div>
  );
});
