import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { artworkUrl } from "../api.js";
import type { AppSnapshot, MusicApplication } from "../contracts.js";
import { Icon } from "./Icon.js";
import type { PlayerTransition } from "./usePlayerTransition.js";

interface DockGesture {
  id: number;
  x: number;
  y: number;
  horizontal: boolean | null;
  opening: boolean;
  offset: number;
  lastY: number;
  lastTime: number;
  speed: number;
}

interface CoverMotion {
  direction: -1 | 1;
  offset: number;
}

function releaseCover(node: HTMLSpanElement | null) {
  node?.removeAttribute("data-dragging");
  node?.style.removeProperty("--dock-drag-offset");
}

export function MobileDock({
  app,
  snapshot,
  transition,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
  transition: PlayerTransition;
}) {
  const { playback, library, navigation, auth } = snapshot;
  const track = playback.current;
  const liked = library.liked.some((item) => item.id === track?.id);
  const busy = !!track && library.busyIds.includes(track.id);
  const playing = playback.playing || playback.desiredPlaying;
  const hidden =
    !navigation.mobile ||
    !track ||
    auth.state !== "ready" ||
    navigation.view === "player" ||
    navigation.view === "lyrics";
  const trackKey = `${playback.index}:${track?.id || ""}`;
  const cover = artworkUrl(track?.coverUrl || "");
  const previous = useRef({ key: trackKey, cover });
  const coverWindow = useRef<HTMLSpanElement>(null);
  const incoming = useRef<HTMLImageElement>(null);
  const outgoing = useRef<HTMLImageElement>(null);
  const swipeStart = useRef<DockGesture | null>(null);
  const requested = useRef<CoverMotion | null>(null);
  const [slide, setSlide] = useState<(CoverMotion & { cover: string }) | null>(null);
  const swiped = useRef(false);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { key: trackKey, cover };
    if (!hidden && before.key === trackKey) return;
    const request = requested.current;
    requested.current = null;
    swipeStart.current = null;
    releaseCover(coverWindow.current);
    const animated =
      !hidden &&
      request &&
      incoming.current?.animate &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setSlide(animated ? { ...request, cover: before.cover } : null);
  }, [cover, hidden, trackKey]);
  useLayoutEffect(() => {
    const front = incoming.current;
    const back = outgoing.current;
    if (!slide || !front || !back) return;
    let cancelled = false;
    const animations: Animation[] = [];
    const animate = () => {
      if (cancelled) return;
      const options = { duration: 180, easing: "ease-in-out", fill: "both" as const };
      const enter = front.animate(
        [
          {
            transform: "translateX(calc(var(--dock-slide-distance) + var(--dock-slide-offset)))",
            opacity: 0,
          },
          { transform: "translateX(0)", opacity: 1 },
        ],
        options,
      );
      const leave = back.animate(
        [
          { transform: "translateX(var(--dock-slide-offset))", opacity: 1 },
          { transform: "translateX(calc(-1 * var(--dock-slide-distance)))", opacity: 0 },
        ],
        options,
      );
      animations.push(enter, leave);
      enter.onfinish = () => setSlide((active) => (active === slide ? null : active));
    };
    if (front.decode) void front.decode().then(animate, animate);
    else animate();
    return () => {
      cancelled = true;
      for (const animation of animations) {
        animation.onfinish = null;
        animation.cancel();
      }
    };
  }, [slide]);
  const cancelSwipe = (id: number) => {
    const gesture = swipeStart.current;
    if (gesture?.id !== id) return;
    swipeStart.current = null;
    releaseCover(coverWindow.current);
    if (gesture.opening) transition.endOpen(false);
  };
  return (
    <aside
      className="mobile-dock"
      aria-label="迷你播放器"
      hidden={hidden}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        swiped.current = false;
        if (
          slide ||
          requested.current ||
          (event.pointerType !== "touch" && event.pointerType !== "pen")
        )
          return;
        swipeStart.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          horizontal: null,
          opening: false,
          offset: 0,
          lastY: event.clientY,
          lastTime: event.timeStamp,
          speed: 0,
        };
      }}
      onPointerMove={(event) => {
        const start = swipeStart.current;
        const node = coverWindow.current;
        if (start?.id !== event.pointerId || !node) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (start.horizontal === null) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
          start.horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        if (!start.horizontal) {
          if (!start.opening && dy >= 0) return;
          const elapsed = event.timeStamp - start.lastTime;
          if (elapsed > 0) {
            const speed = (start.lastY - event.clientY) / elapsed;
            start.speed = elapsed > 85 ? speed : 0.35 * start.speed + 0.65 * speed;
            start.lastY = event.clientY;
            start.lastTime = event.timeStamp;
          }
          start.opening = true;
          swiped.current = true;
          transition.dragOpen(-dy);
          return;
        }
        swiped.current = true;
        start.offset = Math.max(-32, Math.min(32, dx * 0.55));
        node.dataset.dragging = "";
        node.style.setProperty("--dock-drag-offset", `${start.offset}px`);
      }}
      onPointerUp={(event) => {
        const start = swipeStart.current;
        if (start?.id !== event.pointerId) return;
        swipeStart.current = null;
        const dx = event.clientX - start.x;
        const rise = start.y - event.clientY;
        const horizontal = start.horizontal ?? Math.abs(dx) > Math.abs(rise) * 1.3;
        if (horizontal && Math.abs(dx) >= 48) {
          swiped.current = true;
          const request = { direction: dx < 0 ? 1 : -1, offset: start.offset } as const;
          requested.current = request;
          void app.skipTrack(dx < 0 ? "next" : "previous").finally(() => {
            if (requested.current !== request) return;
            requested.current = null;
            releaseCover(coverWindow.current);
          });
        } else {
          releaseCover(coverWindow.current);
          const commit = !horizontal && rise >= 48 && rise >= Math.abs(dx) * 1.3;
          if (commit) swiped.current = true;
          if (start.opening) {
            // A hand that pauses before releasing has no momentum to carry into the animation.
            const pause = Math.max(0, event.timeStamp - start.lastTime - 20);
            const speed = Math.max(0, start.speed * (1 - Math.min(1, pause / 65)));
            transition.endOpen(commit, speed);
          } else if (commit) transition.open();
        }
      }}
      onPointerCancel={(event) => cancelSwipe(event.pointerId)}
      onLostPointerCapture={(event) => {
        if (event.target === event.currentTarget) cancelSwipe(event.pointerId);
      }}
      onClickCapture={(event) => {
        if (!swiped.current || event.detail === 0) return;
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        className="dock-track"
        onClick={transition.open}
        aria-label={`打开播放页：${track?.title || ""}`}
      >
        <span
          ref={coverWindow}
          className="dock-cover-window"
          data-sliding={slide ? "" : undefined}
          style={
            slide
              ? ({
                  "--dock-slide-offset": `${slide.offset}px`,
                  "--dock-slide-direction": slide.direction,
                } as CSSProperties)
              : undefined
          }
        >
          <img
            ref={incoming}
            className="dock-cover"
            src={cover}
            alt=""
            draggable={false}
            decoding="async"
          />
          {slide && (
            <img
              ref={outgoing}
              className="dock-cover-leaving"
              src={slide.cover}
              alt=""
              draggable={false}
              decoding="async"
            />
          )}
        </span>
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
        data-glyph={playing ? "pause" : "play"}
        aria-label={playback.loading ? "取消加载" : playing ? "暂停" : "播放"}
        aria-busy={playback.loading}
        onClick={() => app.togglePlay()}
      >
        <Icon name={playing ? "pause" : "play"} />
      </button>
      <button
        id="dock-queue-toggle"
        className="dock-action"
        aria-label="播放队列"
        aria-expanded={navigation.queueOpen}
        aria-controls="queue-panel"
        onClick={() => (navigation.queueOpen ? app.closeQueue() : app.openQueue())}
      >
        <Icon name="queue" />
      </button>
    </aside>
  );
}
