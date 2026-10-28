import { artworkUrl } from "../api.js";
import type { MusicApplication, Track } from "../contracts.js";
import { Icon } from "./Icon.js";

/** The full-width song action and overlaid queue button stay separate keyboard targets. */
export function TrackRow({
  app,
  track,
  origin,
}: {
  app: MusicApplication;
  track: Track;
  origin: "search" | "liked" | "album";
}) {
  return (
    <div className="track-result-row">
      <button
        type="button"
        className="artist-row"
        data-search-track={origin === "search" ? track.id : undefined}
        data-liked-track={origin === "liked" ? track.id : undefined}
        data-album-track={origin === "album" ? track.id : undefined}
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
      <button
        type="button"
        className="icon-button track-next"
        data-next-track={track.id}
        title="添加到下一首播放"
        aria-label={`添加 ${track.title} 到下一首播放`}
        onClick={() => void app.insertTrackNext(track)}
      >
        <Icon name="queueNext" />
      </button>
    </div>
  );
}
