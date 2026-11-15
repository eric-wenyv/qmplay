import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { artworkUrl } from "../api.js";
import type { MusicApplication, Track } from "../contracts.js";
import { Icon } from "./Icon.js";

export function TrackActions({
  app,
  track,
  onClose,
}: {
  app: MusicApplication;
  track: Track;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal?.();
    return () => {
      node?.close?.();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="track-actions"
      aria-label={`${track.title} 的更多操作`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="track-actions-content">
        <div className="action-song">
          <img src={artworkUrl(track.coverUrl || "")} alt="" />
          <span>
            <strong>{track.title}</strong>
            <small>{track.artist}</small>
          </span>
        </div>
        <button
          onClick={() => {
            void app.insertTrackNext(track, { autoplay: true });
            onClose();
          }}
        >
          <Icon name="play" />
          立即播放
        </button>
        <button
          data-next-track={track.id}
          onClick={() => {
            void app.insertTrackNext(track);
            onClose();
          }}
        >
          <Icon name="queueNext" />
          下一首播放
        </button>
        <button className="action-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
