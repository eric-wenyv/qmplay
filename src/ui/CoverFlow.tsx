import { useEffect, useLayoutEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { artworkUrl } from "../api.js";
import type { AppSnapshot, MusicApplication } from "../contracts.js";
import { playHaptic } from "../platform/haptics.js";
import { useArtworkTheme } from "./useArtworkTheme.js";

interface Drag {
  id: number;
  x: number;
  y: number;
  step: number;
  horizontal: boolean;
}

export function CoverFlow({
  app,
  playback: { queue, index: playingIndex, current },
  selectedIndex,
  onPreview,
  active,
}: {
  app: MusicApplication;
  playback: AppSnapshot["playback"];
  selectedIndex: number;
  onPreview: (index: number) => void;
  active: boolean;
}) {
  const flow = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const previousPreview = useRef<{ index: number; id: string } | null>(null);
  const theme = useArtworkTheme();
  const cover = current?.coverUrl;
  const preview = selectedIndex !== playingIndex ? queue[selectedIndex] : undefined;
  const previewId = preview?.id;
  useEffect(() => {
    if (image.current) theme(image.current);
  }, [cover, current?.id, playingIndex, theme]);
  useLayoutEffect(() => {
    const before = previousPreview.current;
    previousPreview.current = active && previewId ? { index: selectedIndex, id: previewId } : null;
    if (!active || before?.index !== playingIndex || before.id !== current?.id) return;
    const artwork = image.current?.closest<HTMLElement>(".album-art");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!artwork?.animate || motion.matches) return;
    const settle = artwork.animate(
      [
        { scale: "1", translate: "0 0" },
        { scale: "0.976", translate: "0 2px", offset: 0.38 },
        { scale: "1", translate: "0 0" },
      ],
      { duration: 280, easing: "cubic-bezier(0.2, 0.65, 0.3, 1)" },
    );
    const onPreference = () => {
      if (motion.matches) settle.cancel();
    };
    motion.addEventListener("change", onPreference);
    settle.onfinish = settle.oncancel = () => motion.removeEventListener("change", onPreference);
    return () => {
      settle.cancel();
      motion.removeEventListener("change", onPreference);
    };
  }, [active, current?.id, playingIndex, previewId, selectedIndex]);

  const reset = (node: HTMLDivElement) => {
    drag.current = null;
    node.removeAttribute("data-dragging");
    node.style.removeProperty("--cover-drag");
  };
  useLayoutEffect(() => {
    const node = flow.current;
    if (node) reset(node);
  }, [active, current?.id, selectedIndex]);

  const select = (step: number, tactile = false) => {
    const target = selectedIndex + step;
    if (target < 0 || target >= queue.length) return;
    onPreview(target);
    if (tactile) playHaptic("cover-step");
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const node = event.currentTarget;
    if (!gesture.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        reset(node);
        return;
      }
      gesture.horizontal = true;
      suppressClick.current = true;
      node.dataset.dragging = "true";
      node.setPointerCapture?.(event.pointerId);
    }
    const atEdge = dx > 0 ? selectedIndex === 0 : selectedIndex === queue.length - 1;
    const limit = atEdge ? 0.22 : 1;
    const progress = dx / gesture.step;
    node.style.setProperty("--cover-drag", String(Math.max(-limit, Math.min(limit, progress))));
  };

  const start = Math.max(0, selectedIndex - 2);
  return (
    <div
      ref={flow}
      className="cover-flow"
      onPointerDown={(event) => {
        if (!active || !event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          step: Math.max(1, event.currentTarget.clientWidth * 0.455),
          horizontal: false,
        };
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        const gesture = drag.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        reset(event.currentTarget);
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
        suppressClick.current = true;
        if (Math.abs(dx) >= Math.max(24, Math.min(56, gesture.step / 2)))
          select(dx < 0 ? 1 : -1, event.pointerType === "touch" || event.pointerType === "pen");
      }}
      onPointerCancel={(event) => {
        if (drag.current?.id === event.pointerId) reset(event.currentTarget);
      }}
      onLostPointerCapture={(event) => {
        if (event.target === event.currentTarget && drag.current?.id === event.pointerId)
          reset(event.currentTarget);
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current || event.detail === 0) return;
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      {queue.slice(start, selectedIndex + 3).map((track, slot) => {
        const position = start + slot;
        const offset = position - selectedIndex;
        return (
          <div
            key={`${track.id}:${position}`}
            className="cover-flow-card"
            data-offset={offset}
            style={{ "--cover-offset": offset } as CSSProperties}
            aria-hidden={Math.abs(offset) > 1 || undefined}
          >
            <div className="album-art" data-art="original">
              <img
                ref={position === playingIndex ? image : undefined}
                id={offset === 0 ? "cover-image" : undefined}
                src={artworkUrl(track.coverUrl || "")}
                alt={offset === 0 && track.coverUrl ? `${track.album || track.title} 封面` : ""}
                width="1024"
                height="1024"
                fetchPriority={offset === 0 ? "high" : undefined}
                draggable={false}
                onLoad={
                  position === playingIndex ? (event) => theme(event.currentTarget) : undefined
                }
              />
              <div className="art-light" aria-hidden="true" />
            </div>
          </div>
        );
      })}
      <p className="cover-flow-title" aria-live="polite">
        {preview?.title}
      </p>
      <button
        id="album-art"
        className="cover-flow-action"
        type="button"
        aria-label={preview ? `播放 ${preview.title}` : "查看歌词"}
        aria-controls={preview ? undefined : "lyrics-view"}
        onClick={() => {
          if (preview) void app.selectTrack(selectedIndex);
          else app.showLyrics();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          select(event.key === "ArrowRight" ? 1 : -1);
        }}
      />
    </div>
  );
}
