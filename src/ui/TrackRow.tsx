import { artworkUrl } from "../api.js";
import type { MusicApplication, Track } from "../contracts.js";
import { Icon } from "./Icon.js";

/** The full-width song action and overlaid queue button stay separate keyboard targets. */
export function TrackRow({
  app,
  track,
  origin,
  current = false,
  onMore,
}: {
  app: MusicApplication;
  track: Track;
  origin: "search" | "liked" | "album";
  current?: boolean;
  onMore?: (track: Track) => void;
}) {
  return (
    <div className="track-result-row" data-current={current}>
      <button
        type="button"
        className="artist-row"
        data-search-track={origin === "search" ? track.id : undefined}
        data-liked-track={origin === "liked" ? track.id : undefined}
        data-album-track={origin === "album" ? track.id : undefined}
        aria-current={current ? "true" : undefined}
        aria-label={`播放 ${track.title}，${track.artist || ""}`}
        onClick={() => void app.insertTrackNext(track, { autoplay: true })}
      >
        <span className="artist-avatar radio-avatar">
          <img src={artworkUrl(track.coverUrl || "")} alt="" loading="lazy" />
        </span>
        <span className="artist-row-copy">
          <span className="artist-name">{track.title}</span>
          <span className="artist-followers">{track.artist}</span>
        </span>
      </button>
      {current && (
        <span className="row-equalizer mini-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <button
        type="button"
        className="icon-button track-next"
        data-next-track={onMore ? undefined : track.id}
        data-more-track={onMore ? track.id : undefined}
        title={onMore ? "更多操作" : "添加到下一首播放"}
        aria-label={onMore ? `${track.title} 的更多操作` : `添加 ${track.title} 到下一首播放`}
        onClick={() => (onMore ? onMore(track) : void app.insertTrackNext(track))}
      >
        <Icon name={onMore ? "more" : "queueNext"} />
      </button>
    </div>
  );
}
