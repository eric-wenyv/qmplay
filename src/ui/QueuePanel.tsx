import { useLayoutEffect, useRef, useState } from "react";
import { artworkUrl } from "../api.js";
import { formatTime } from "../player.js";
import type { AppSnapshot, MusicApplication, Track } from "../contracts.js";
import { Icon } from "./Icon.js";

const rowHeight = 70;
const windowSize = 60;

interface QueueWindow {
  queue: Track[];
  start: number;
  end: number;
  currentIndex: number;
  historical: boolean;
}

interface QueueGesture {
  id: number;
  x: number;
  y: number;
  horizontal: boolean;
  offset: number;
  preview: number | null;
  width: number;
}

interface QueueMotion {
  target: number | null;
  offset: number;
}

export function QueuePanel({
  app,
  snapshot,
  placement,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
  placement: "inline" | "dock" | "desktop";
}) {
  const list = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const [motion, setMotion] = useState<QueueMotion | null>(null);
  const pendingFocus = useRef<{ index: number; remove: boolean } | null>(null);
  const pointer = useRef<QueueGesture | null>(null);
  const swiped = useRef(false);
  const { playback, navigation } = snapshot;
  const visible = navigation.queueOpen;
  const page = Math.min(historyPage, playback.history.length);
  const history = page > 0 ? playback.history[page - 1] : undefined;
  const queue = history?.queue ?? playback.queue;
  const currentIndex = history ? -1 : playback.index;
  const source = history ? history.source : playback.source;
  const playHistory = (index?: number) => {
    setMotion(null);
    setPreview(null);
    setHistoryPage(0);
    void app.playQueueHistory(page - 1, index);
  };
  useLayoutEffect(() => {
    if (visible) setHistoryPage(0);
    else {
      pointer.current = null;
      swiped.current = false;
      strip.current?.style.removeProperty("transform");
      setMotion(null);
      setPreview(null);
    }
  }, [visible]);
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0;
    setScrollTop(0);
    pendingFocus.current = null;
  }, [page, source?.type, source?.resource?.id]);
  const virtual = queue.length > 200;
  const start = virtual
    ? Math.min(
        Math.max(0, queue.length - windowSize),
        Math.max(0, Math.floor(scrollTop / rowHeight) - 10),
      )
    : 0;
  const end = virtual ? Math.min(queue.length, start + windowSize) : queue.length;
  const rows = { queue, start, end, currentIndex, historical: !!history };
  const adjacentPage = (delta: number) => {
    const next = page + delta;
    return next >= 0 && next <= playback.history.length ? next : null;
  };
  const settle = (target: number | null, offset = 0) => {
    if (motion) return;
    if (target === null && !offset) {
      strip.current?.style.removeProperty("transform");
      setPreview(null);
      return;
    }
    const node = list.current;
    if (node?.contains(document.activeElement)) node.focus({ preventScroll: true });
    if (target !== null) setPreview(target);
    setMotion({ target, offset });
  };
  const changePage = (delta: number) => {
    settle(adjacentPage(delta));
  };
  useLayoutEffect(() => {
    const node = strip.current;
    if (!motion || !visible || !node) return;
    const finish = () => {
      if (motion.target !== null) setHistoryPage(motion.target);
      setPreview(null);
      setMotion(null);
    };
    if (!node.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.style.removeProperty("transform");
      finish();
      return;
    }
    const destination = motion.target === null ? 0 : motion.target > page ? -100 : 100;
    const animation = node.animate(
      [
        { transform: `translateX(${motion.offset}px)` },
        { transform: `translateX(${destination}%)` },
      ],
      { duration: motion.target === null ? 150 : 210, easing: "ease-in-out", fill: "both" },
    );
    animation.onfinish = finish;
    return () => {
      animation.onfinish = null;
      animation.cancel();
      node.style.removeProperty("transform");
    };
  }, [motion, page, visible]);
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
  const previewQueue = preview === 0 ? playback.queue : playback.history[(preview ?? 0) - 1]?.queue;
  return (
    <aside
      id="queue-panel"
      className={`queue-panel queue-${placement}`}
      role={placement === "inline" ? "region" : "dialog"}
      aria-modal={placement === "inline" ? undefined : true}
      aria-label="播放队列"
      data-open={visible}
      inert={!visible}
      aria-hidden={!visible}
      hidden={!visible && placement !== "dock"}
    >
      <header className="queue-header">
        <h2>
          {history ? `历史队列 ${page}/${playback.history.length}` : "播放队列"}{" "}
          <span id="queue-count">{String(queue.length).padStart(2, "0")}</span>
        </h2>
        <div className="queue-header-actions">
          {playback.history.length > 0 && (
            <nav className="queue-pages" aria-label="队列历史">
              <button
                type="button"
                aria-label="较新的队列"
                disabled={page === 0}
                onClick={() => changePage(-1)}
              >
                <Icon name="arrowLeft" />
              </button>
              <button
                type="button"
                aria-label="较早的队列"
                disabled={page === playback.history.length}
                onClick={() => changePage(1)}
              >
                <Icon name="arrowRight" />
              </button>
            </nav>
          )}
          {history && (
            <button className="queue-play-all" type="button" onClick={() => playHistory()}>
              <Icon name="play" />
              播放全部
            </button>
          )}
          <button
            id="close-queue"
            className="icon-button small"
            type="button"
            aria-label="关闭播放队列"
            onClick={() => app.closeQueue()}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div
        className="queue-list-viewport"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || motion || !playback.history.length) return;
          swiped.current = false;
          pointer.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            horizontal: false,
            offset: 0,
            preview: null,
            width: event.currentTarget.clientWidth,
          };
        }}
        onPointerMove={(event) => {
          const gesture = pointer.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          const dx = event.clientX - gesture.x;
          const dy = event.clientY - gesture.y;
          if (!gesture.horizontal) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
            if (Math.abs(dx) < Math.abs(dy) * 1.3) {
              pointer.current = null;
              return;
            }
            gesture.horizontal = true;
            swiped.current = true;
          }
          const target = adjacentPage(dx < 0 ? 1 : -1);
          const limit = target === null ? gesture.width * 0.15 : gesture.width;
          const distance = target === null ? dx * 0.2 : dx;
          gesture.offset = Math.max(-limit, Math.min(limit, distance));
          strip.current?.style.setProperty("transform", `translateX(${gesture.offset}px)`);
          if (gesture.preview !== target) {
            gesture.preview = target;
            setPreview(target);
          }
        }}
        onPointerUp={(event) => {
          const gesture = pointer.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          pointer.current = null;
          const dx = event.clientX - gesture.x;
          const dy = event.clientY - gesture.y;
          const commit =
            Math.abs(dx) >= 48 && (gesture.horizontal || Math.abs(dx) >= Math.abs(dy) * 1.3);
          if (commit) swiped.current = true;
          settle(commit ? adjacentPage(dx < 0 ? 1 : -1) : null, gesture.offset);
        }}
        onPointerCancel={(event) => {
          const gesture = pointer.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          pointer.current = null;
          settle(null, gesture.offset);
        }}
        onClickCapture={(event) => {
          if (!motion && (!swiped.current || event.detail === 0)) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className="queue-list-strip" ref={strip}>
          <div
            ref={list}
            id="queue-list"
            className="queue-list"
            aria-label="歌曲列表"
            tabIndex={-1}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            onKeyDown={(event) => {
              if (
                playback.history.length &&
                (event.key === "ArrowLeft" || event.key === "ArrowRight")
              ) {
                event.preventDefault();
                changePage(event.key === "ArrowRight" ? 1 : -1);
                return;
              }
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
                  remove = !history;
                } else if (!event.shiftKey && (remove || history) && index < queue.length - 1) {
                  next = index + 1;
                  remove = false;
                }
              }
              if (next === undefined) return;
              event.preventDefault();
              focusRow(next, remove);
            }}
          >
            <QueueRows
              {...rows}
              onSelect={(index) => (history ? playHistory(index) : void app.selectTrack(index))}
              onRemove={(index) => {
                pendingFocus.current = {
                  index: Math.max(0, Math.min(index, queue.length - 2)),
                  remove: false,
                };
                app.removeTrack(index);
              }}
            />
          </div>
          {preview !== null && previewQueue && (
            <div
              className="queue-list queue-list-preview"
              style={{ transform: `translateX(${preview > page ? 100 : -100}%)` }}
              aria-hidden="true"
              inert
            >
              <QueueRows
                queue={previewQueue}
                start={0}
                end={Math.min(16, previewQueue.length)}
                currentIndex={preview === 0 ? playback.index : -1}
                historical={preview > 0}
              />
            </div>
          )}
        </div>
      </div>
      <p id="queue-message" className="queue-message" role="status">
        {snapshot.notice?.message || ""}
      </p>
    </aside>
  );
}

function QueueRows({
  queue,
  start,
  end,
  currentIndex,
  historical,
  onSelect,
  onRemove,
}: QueueWindow & {
  onSelect?(index: number): void;
  onRemove?(index: number): void;
}) {
  return (
    <>
      {start > 0 && <div aria-hidden="true" style={{ height: start * rowHeight }} />}
      {queue.slice(start, end).map((track, offset) => {
        const index = start + offset;
        return (
          <div
            className="queue-item"
            key={`${track.id}:${index}`}
            data-current={index === currentIndex}
            data-historical={historical}
          >
            <button
              type="button"
              className="queue-row"
              data-index={index}
              aria-current={index === currentIndex}
              aria-label={`播放 ${track.title}，${track.artist || ""}`}
              onClick={() => onSelect?.(index)}
            >
              <span className="queue-number">
                {index === currentIndex ? (
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
            {!historical && (
              <button
                type="button"
                className="icon-button queue-remove"
                data-remove={index}
                aria-label={`从队列移除 ${track.title}`}
                onClick={() => onRemove?.(index)}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        );
      })}
      {end < queue.length && (
        <div aria-hidden="true" style={{ height: (queue.length - end) * rowHeight }} />
      )}
      {!queue.length && <p className="queue-empty">这里还没有歌曲</p>}
    </>
  );
}
