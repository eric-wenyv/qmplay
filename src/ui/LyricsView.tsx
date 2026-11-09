import { useEffect, useRef } from "react";
import type { AppSnapshot, MusicApplication } from "../contracts.js";

const scrollKeys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"];

export function LyricsView({
  app,
  snapshot,
  inline,
}: {
  app: MusicApplication;
  snapshot: AppSnapshot;
  inline: boolean;
}) {
  const lines = useRef<HTMLDivElement>(null);
  const scrollbarTimer = useRef<number | undefined>(undefined);
  const active = snapshot.lyrics.findLastIndex((line) => line.time <= snapshot.playback.elapsed);
  const visible = inline
    ? Boolean(snapshot.playback.current)
    : snapshot.navigation.view === "lyrics";
  const revealScrollbar = (node: HTMLDivElement) => {
    if (node.scrollHeight <= node.clientHeight) return;
    node.dataset.scrolling = "true";
    window.clearTimeout(scrollbarTimer.current);
    scrollbarTimer.current = window.setTimeout(() => delete node.dataset.scrolling, 900);
  };
  useEffect(() => {
    if (!inline || !visible) return;
    const node = lines.current;
    return () => {
      window.clearTimeout(scrollbarTimer.current);
      node?.removeAttribute("data-scrolling");
    };
  }, [inline, visible]);
  useEffect(() => {
    const node = lines.current;
    const target = node?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!visible || !node || !target) return;
    node.scrollTo?.({
      top: target.offsetTop - node.offsetTop - node.clientHeight / 2 + target.clientHeight / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [active, inline, visible, snapshot.playback.current?.id]);
  return (
    <section id="lyrics-view" className="search-view" aria-label="歌词" hidden={!visible}>
      <div className="browse-heading">
        <h2 id="lyrics-title">{inline ? "歌词" : snapshot.playback.current?.title || "歌词"}</h2>
      </div>
      <div
        ref={lines}
        id="lyrics-lines"
        className="lyrics-lines"
        aria-busy={snapshot.requests.lyrics}
        tabIndex={inline ? 0 : undefined}
        onWheel={
          inline
            ? (event) => {
                if (!event.ctrlKey && event.deltaY) revealScrollbar(event.currentTarget);
              }
            : undefined
        }
        onTouchMove={inline ? (event) => revealScrollbar(event.currentTarget) : undefined}
        onScroll={
          inline
            ? (event) => {
                if (event.currentTarget.dataset.scrolling) revealScrollbar(event.currentTarget);
              }
            : undefined
        }
        onKeyDown={
          inline
            ? (event) => {
                if (scrollKeys.includes(event.key)) revealScrollbar(event.currentTarget);
              }
            : undefined
        }
      >
        {snapshot.requests.lyrics ? (
          <p className="results-message">正在加载歌词…</p>
        ) : snapshot.lyrics.length ? (
          snapshot.lyrics.map((line, index) => (
            <button
              key={`${line.time}:${index}`}
              className="lyric-line"
              type="button"
              data-time={line.time}
              aria-current={index === active}
              onClick={() => app.seek(line.time)}
            >
              {line.text}
            </button>
          ))
        ) : (
          <p className="results-message">纯音乐或暂无歌词</p>
        )}
      </div>
    </section>
  );
}
