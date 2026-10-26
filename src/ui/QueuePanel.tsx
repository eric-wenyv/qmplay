import { useLayoutEffect, useRef, useState } from "react";
import { artworkUrl } from "../api.js";
import { formatTime } from "../player.js";
import type { AppSnapshot, MusicApplication } from "../contracts.js";
import { Icon } from "./Icon.js";

const rowHeight = 70;
const windowSize = 60;

export function QueuePanel({ app, snapshot }: { app: MusicApplication; snapshot: AppSnapshot }) {
  const list = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const pendingFocus = useRef<{ index: number; remove: boolean } | null>(null);
  const queue = snapshot.playback.queue;
  const mobile = snapshot.navigation.mobile;
  const visible = mobile ? snapshot.navigation.view === "queue" : snapshot.navigation.queueOpen;
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0;
    setScrollTop(0);
  }, [snapshot.playback.source?.type, snapshot.playback.source?.resource?.id]);
  const virtual = queue.length > 200;
  const start = virtual
    ? Math.min(
        Math.max(0, queue.length - windowSize),
        Math.max(0, Math.floor(scrollTop / rowHeight) - 10),
      )
    : 0;
  const end = virtual ? Math.min(queue.length, start + windowSize) : queue.length;
  useLayoutEffect(() => {
    if (!pendingFocus.current || !visible) return;
    const focus = pendingFocus.current;
    const target = list.current?.querySelector<HTMLElement>(
      `[data-${focus.remove ? "remove" : "index"}="${focus.index}"]`,
    );
    if (target) {
      target.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [start, end, queue, visible]);
  const focusRow = (index: number, remove: boolean) => {
    const node = list.current;
    if (!node) return;
    pendingFocus.current = { index, remove };
    const nextScroll = Math.max(0, index * rowHeight - node.clientHeight / 2);
    node.scrollTop = nextScroll;
    setScrollTop(nextScroll);
    const target = node.querySelector<HTMLElement>(
      `[data-${remove ? "remove" : "index"}="${index}"]`,
    );
    if (target) {
      target.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  };
  return (
    <aside
      id="queue-panel"
      className={`queue-panel${mobile ? " search-view" : ""}`}
      role={mobile ? "region" : "dialog"}
      aria-modal={mobile ? undefined : true}
      aria-label="播放队列"
      tabIndex={mobile ? -1 : undefined}
      hidden={!visible}
    >
      <header className="queue-header">
        <h2>
          播放队列 <span id="queue-count">{String(queue.length).padStart(2, "0")}</span>
        </h2>
        <button
          id="close-queue"
          className="icon-button small"
          type="button"
          aria-label="关闭播放队列"
          onClick={() => app.closeQueue()}
        >
          <Icon name="close" />
        </button>
      </header>
      <div
        ref={list}
        id="queue-list"
        className="queue-list"
        aria-label="歌曲列表"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={(event) => {
          if (!virtual || !(event.target instanceof Element)) return;
          const row = event.target.closest<HTMLElement>("[data-index], [data-remove]");
          if (!row) return;
          const index = Number(row.dataset.index ?? row.dataset.remove);
          let remove = row.dataset.remove !== undefined;
          let next: number | undefined;
          if (event.key === "Home") next = 0;
          else if (event.key === "End") next = queue.length - 1;
          else if (event.key === "ArrowDown") next = Math.min(queue.length - 1, index + 1);
          else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
          else if (event.key === "Tab") {
            if (event.shiftKey && !remove && index > 0) {
              next = index - 1;
              remove = true;
            } else if (!event.shiftKey && remove && index < queue.length - 1) {
              next = index + 1;
              remove = false;
            }
          }
          if (next === undefined) return;
          event.preventDefault();
          focusRow(next, remove);
        }}
      >
        {start > 0 && <div aria-hidden="true" style={{ height: start * rowHeight }} />}
        {queue.slice(start, end).map((track, offset) => {
          const index = start + offset;
          return (
            <div className="queue-item" key={`${track.id}:${index}`}>
              <button
                type="button"
                className="queue-row"
                data-index={index}
                aria-current={index === snapshot.playback.index}
                aria-label={`播放 ${track.title}，${track.artist || ""}`}
                onClick={() => void app.selectTrack(index)}
              >
                <span className="queue-number">
                  {index === snapshot.playback.index ? (
                    <span className="mini-bars" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span className="queue-cover album-art">
                  <img
                    src={artworkUrl(track.coverUrl || "")}
                    alt=""
                    width="42"
                    height="42"
                    loading="lazy"
                  />
                </span>
                <span className="queue-copy">
                  <span className="queue-title">{track.title}</span>
                  <span className="queue-artist">{track.artist}</span>
                </span>
                <span className="queue-time">{formatTime(track.duration || 0)}</span>
              </button>
              <button
                type="button"
                className="queue-remove"
                data-remove={index}
                aria-label={`从队列移除 ${track.title}`}
                onClick={() => {
                  pendingFocus.current = {
                    index: Math.max(0, Math.min(index, queue.length - 2)),
                    remove: false,
                  };
                  app.removeTrack(index);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        {end < queue.length && (
          <div aria-hidden="true" style={{ height: (queue.length - end) * rowHeight }} />
        )}
        {!queue.length && <p className="queue-empty">这里还没有歌曲</p>}
      </div>
      <p id="queue-message" className="queue-message" role="status">
        {snapshot.notice?.message || ""}
      </p>
    </aside>
  );
}
