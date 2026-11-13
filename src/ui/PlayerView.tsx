import { Fragment, memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { artworkUrl, artistsOnTrack } from "../api.js";
import { formatTime, orderLabels, orderModes } from "../player.js";
import type { AppSnapshot, Artist, MusicApplication, PlayOrder, View } from "../contracts.js";
import { CoverFlow } from "./CoverFlow.js";
import { Icon } from "./Icon.js";
import { describePage } from "./Navigation.js";
import { useArtworkTheme } from "./useArtworkTheme.js";
import { useMobileWheelMotion } from "./useMobileWheelMotion.js";

function artistFromName(id: string, name: string): Artist {
  return {
    id,
    name,
    followerCount: null,
    avatarUrl: `https://y.gtimg.cn/music/photo_new/T001R150x150M000${encodeURIComponent(id)}.jpg`,
  };
}

export function PlayerView({
  app,
  snapshot,
  wide = false,
  inert,
  selectedIndex,
  onPreview,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
  wide?: boolean;
  inert: boolean;
  selectedIndex: number;
  onPreview: (index: number) => void;
}) {
  const { current, index, source } = snapshot.playback;
  const { mobile, view } = snapshot.navigation;
  const showPlayer = view === "player" || (wide && view === "lyrics");
  const image = useRef<HTMLImageElement>(null);
  const theme = useArtworkTheme();
  const cover = artworkUrl(current?.coverUrl || "");
  const liked = snapshot.library.liked.some((track) => track.id === current?.id);
  const busy = Boolean(current && snapshot.library.busyIds.includes(current.id));
  const singers = artistsOnTrack(current);
  useEffect(() => {
    if (image.current) theme(image.current);
  }, [cover, mobile, theme]);
  return (
    <>
      <div id="listening-view" className="listening-view" hidden={!showPlayer || !current}>
        {mobile ? (
          current && (
            <CoverFlow
              app={app}
              playback={snapshot.playback}
              selectedIndex={selectedIndex}
              onPreview={onPreview}
              active={view === "player" && !inert}
            />
          )
        ) : (
          <div
            id="album-art"
            className="album-art"
            data-art="original"
            role={wide ? undefined : "button"}
            tabIndex={!wide && current ? 0 : undefined}
            aria-label={wide ? undefined : "查看歌词"}
            aria-controls={wide ? undefined : "lyrics-view"}
            aria-expanded={wide ? undefined : view === "lyrics"}
            onClick={wide ? undefined : () => app.showLyrics()}
            onKeyDown={
              wide
                ? undefined
                : (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      app.showLyrics();
                    }
                  }
            }
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
        )}
        <div className="track-meta">
          <div className="track-copy">
            <h1 id="track-title">{current?.title || "qmplay"}</h1>
            <p id="track-artist">
              <span id="track-singer">
                {singers.length
                  ? singers.map((singer, index) => (
                      <Fragment key={`${singer.id}:${singer.name}:${index}`}>
                        {index > 0 ? " / " : null}
                        {singer.id ? (
                          <button
                            type="button"
                            className="track-singer-link"
                            data-artist={singer.id}
                            aria-label={`查看 ${singer.name} 的专辑`}
                            onClick={() =>
                              void app.showArtistAlbums(artistFromName(singer.id, singer.name))
                            }
                          >
                            {singer.name}
                          </button>
                        ) : (
                          singer.name
                        )}
                      </Fragment>
                    ))
                  : current?.artist || ""}
              </span>
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
        hidden={!showPlayer || Boolean(current)}
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
  previewIndex,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
  inert: boolean;
  previewIndex: number | null;
}) {
  const { playback, navigation } = snapshot;
  const duration = playback.current?.duration || 0;
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const elapsed = Math.max(0, Math.min(scrubTime ?? playback.elapsed, duration));
  return (
    <footer className="player-footer" inert={inert}>
      <div className="timeline">
        <input
          id="seek"
          type="range"
          min="0"
          max={duration}
          value={elapsed}
          step="1"
          aria-label="播放进度"
          aria-valuetext={`${formatTime(elapsed)} / ${formatTime(duration)}`}
          style={
            {
              "--progress": `${duration ? (elapsed / duration) * 100 : 0}%`,
            } as CSSProperties
          }
          disabled={!playback.current}
          onChange={(event) => app.seek(Number(event.currentTarget.value))}
        />
        <div className="time-labels">
          <span id="elapsed">{formatTime(elapsed)}</span>
          <span id="duration">{formatTime(duration)}</span>
        </div>
      </div>
      <TransportControls
        app={app}
        hasCurrent={Boolean(playback.current)}
        playing={playback.playing}
        loading={playback.loading}
        wantsPlayback={playback.playing || playback.desiredPlaying}
        trackKey={playback.current ? `${playback.index}:${playback.current.id}` : undefined}
        setScrubTime={setScrubTime}
        previewIndex={previewIndex}
        order={playback.order}
        mobile={navigation.mobile}
        inert={inert}
        homeTarget={navigation.view === "player" ? (navigation.mobilePage ?? "liked") : "player"}
        queueOpen={navigation.queueOpen}
      />
    </footer>
  );
}

const TransportControls = memo(function TransportControls({
  app,
  hasCurrent,
  playing,
  loading,
  wantsPlayback,
  trackKey,
  setScrubTime,
  previewIndex,
  order,
  mobile,
  inert,
  homeTarget,
  queueOpen,
}: {
  app: MusicApplication;
  hasCurrent: boolean;
  playing: boolean;
  loading: boolean;
  wantsPlayback: boolean;
  trackKey: string | undefined;
  setScrubTime: (time: number | null) => void;
  previewIndex: number | null;
  order: PlayOrder;
  mobile: boolean;
  inert: boolean;
  homeTarget: View;
  queueOpen: boolean;
}) {
  const { wheel, wave, scrubMode, cancelScrub, onClickCapture, releaseFeedback } =
    useMobileWheelMotion({
      active: mobile && !inert,
      app,
      trackKey,
      order,
      setScrubTime,
    });
  const previewing = previewIndex !== null;
  const busy = loading && !previewing && !scrubMode;
  const canPause = wantsPlayback && !previewing;
  const label = scrubMode ? "取消调带" : busy ? "取消加载" : canPause ? "暂停" : "播放";
  const glyph = scrubMode ? "scrub-cancel" : loading ? "cancel" : playing ? "pause" : "play";
  const destination = mobile ? describePage(homeTarget) : null;
  return (
    <div className="control-deck">
      <nav className="transport" aria-label="播放控制">
        <div
          ref={wheel}
          className="click-wheel"
          onClickCapture={onClickCapture}
          onClick={(event) => {
            if (!mobile || !(event.target instanceof Element)) return;
            const button = event.target.closest("button");
            if (!button || button.disabled) return;
            releaseFeedback(button);
            if (event.detail > 0 && button === document.activeElement) button.blur();
          }}
        >
          {mobile && (
            <div className="wheel-surface" aria-hidden="true">
              <div className="wheel-wave" ref={wave} />
            </div>
          )}
          <button
            id="order-toggle"
            className="icon-button side-control"
            type="button"
            aria-label={`播放顺序：${orderLabels[order]}`}
            data-tip={mobile ? undefined : orderLabels[order]}
            onClick={() => app.cycleOrder()}
          >
            {mobile ? (
              <>
                <span className="wheel-order-drum" aria-hidden="true">
                  {orderModes.map((mode) => (
                    <span key={mode} data-wheel-order={mode} data-selected={mode === order}>
                      <Icon name={mode} />
                    </span>
                  ))}
                </span>
                <span className="wheel-order-caption" aria-hidden="true">
                  {orderLabels[order]}
                </span>
              </>
            ) : (
              <Icon name={order} />
            )}
          </button>
          <button
            id="previous-track"
            className="icon-button skip-control"
            type="button"
            aria-label="上一首"
            data-tip={mobile ? undefined : "上一首"}
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
            aria-busy={busy}
            data-wheel-glyph={mobile ? glyph : undefined}
            data-cancel-armed={scrubMode === "cancel" ? "" : undefined}
            data-tip={`${label} / 空格`}
            disabled={!hasCurrent}
            onClick={() => {
              if (cancelScrub()) return;
              if (previewIndex === null) app.togglePlay();
              else void app.selectTrack(previewIndex);
            }}
          >
            {mobile ? (
              <span className="wheel-play-face" aria-hidden="true">
                <Icon name="play" className="icon-slot wheel-play-glyph wheel-play-triangle" />
                <Icon name="pause" className="icon-slot wheel-play-glyph wheel-pause-bars" />
                <span className="wheel-play-glyph wheel-cancel-square" />
                <Icon name="close" className="icon-slot wheel-play-glyph wheel-scrub-cancel" />
              </span>
            ) : (
              <Icon name={canPause ? "pause" : "play"} />
            )}
          </button>
          <button
            id="next-track"
            className="icon-button skip-control"
            type="button"
            aria-label="下一首"
            data-tip={mobile ? undefined : "下一首"}
            disabled={!hasCurrent}
            onClick={() => void app.advance("next")}
          >
            <Icon name="next" />
          </button>
          {destination ? (
            <button
              id="home-toggle"
              className="icon-button side-control"
              type="button"
              aria-label={destination.label}
              onClick={() => app.toggleMobileHome()}
            >
              <Icon name={destination.icon} />
            </button>
          ) : (
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
          )}
        </div>
      </nav>
    </div>
  );
});
