import { artworkUrl } from "../api.js";
import type { AppSnapshot, MusicApplication } from "../contracts.js";
import { Icon } from "./Icon.js";

export function MobileDock({
  app,
  snapshot,
  onOpen,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
  onOpen(): void;
}) {
  const { playback, library, navigation, auth } = snapshot;
  const track = playback.current;
  const liked = library.liked.some((item) => item.id === track?.id);
  const busy = !!track && library.busyIds.includes(track.id);
  const playing = playback.playing || playback.desiredPlaying;
  return (
    <aside
      className="mobile-dock"
      aria-label="迷你播放器"
      hidden={
        !navigation.mobile ||
        !track ||
        auth.state !== "ready" ||
        navigation.view === "player" ||
        navigation.view === "lyrics"
      }
    >
      <button
        className="dock-track"
        onClick={onOpen}
        aria-label={`打开播放页：${track?.title || ""}`}
      >
        <img
          className="dock-cover"
          src={artworkUrl(track?.coverUrl || "")}
          alt=""
          draggable={false}
        />
        <span className="dock-copy">
          <strong>{track?.title}</strong>
          <span>{track?.artist || "未知歌手"}</span>
        </span>
      </button>
      <button
        className="dock-action dock-like"
        aria-label={liked ? "取消喜欢这首歌" : "喜欢这首歌"}
        aria-pressed={liked}
        disabled={busy}
        onClick={() => void app.toggleLike()}
      >
        <Icon name="heart" />
      </button>
      <button
        className="dock-action dock-play"
        aria-label={playback.loading ? "取消加载" : playing ? "暂停" : "播放"}
        aria-busy={playback.loading}
        onClick={() => app.togglePlay()}
      >
        <Icon name={playing ? "pause" : "play"} />
      </button>
      <button className="dock-action" aria-label="播放队列" onClick={() => app.openQueue()}>
        <Icon name="queue" />
      </button>
    </aside>
  );
}
